import { attachDelivery, decide, expireReview } from './state.mjs';
import { checkLiveArticle, commitArticle, prepareArticle } from './publish.mjs';
import { stagingPacket } from './staging-packet.mjs';
import { groqWriter, readBrief, writeDraft } from '../draft.mjs';
import { checkDraft } from '../fact-check.mjs';

const encoder = new TextEncoder();
const deliveryReasons = new Set([
  'telegram-token-rejected', 'telegram-chat-unavailable', 'telegram-bot-blocked',
  'telegram-request-invalid', 'telegram-rate-limited', 'telegram-connection-failed',
]);
const controls = { a: 'approve', e: 'edit', r: 'reject' };
const statusText = {
  approved: 'Approval recorded.',
  'checks-unresolved': 'Approval blocked. Open the fact-check report and request edits before publishing.',
  'needs-edit': 'Edit requested. The original draft remains unpublished.',
  'revision-queued': 'Edit requested. A revision and fresh fact check are queued.',
  rejected: 'Draft rejected.',
  committed: 'Article committed. Checking the live site.',
  published: 'Article is live.',
  'committed-unverified': 'Article committed. The live page needs a manual check.',
};

async function sameSecret(received, expected) {
  if (!received || !expected || received.length > 512) return false;
  const hashes = await Promise.all([received, expected].map((value) =>
    crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const [left, right] = hashes.map((hash) => new Uint8Array(hash));
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function readJson(request, limit) {
  if (!request.body) throw new Error('Missing body.');
  const reader = request.body.getReader();
  let length = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new Error('Body limit exceeded.');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel();
  }
}

function validPacket(packet) {
  return ['Cricket', 'Football'].includes(packet?.sport) &&
    (packet.testOnly === undefined || typeof packet.testOnly === 'boolean') &&
    ['needs-human-verification', 'held-for-editorial-review'].includes(packet.status) &&
    typeof packet.headline === 'string' && packet.headline.length > 0 && packet.headline.length <= 160 &&
    typeof packet.dek === 'string' && packet.dek.length <= 300 &&
    Array.isArray(packet.paragraphs) && packet.paragraphs.length >= 4 && packet.paragraphs.length <= 10 &&
    packet.paragraphs.every((row) => typeof row?.text === 'string' && row.text.length <= 1500 &&
      ['reporting', 'analysis', 'counterargument'].includes(row.kind) && Array.isArray(row.evidenceIds) &&
      row.evidenceIds.length <= 12 && row.evidenceIds.every((id) => typeof id === 'string' && /^E\d{1,2}$/.test(id))) &&
    Array.isArray(packet.evidence) && packet.evidence.length >= 2 && packet.evidence.length <= 12 &&
    packet.evidence.every((entry) => typeof entry?.id === 'string' && /^E\d{1,2}$/.test(entry.id) &&
      typeof entry.url === 'string' && entry.url.startsWith('https://') && entry.url.length <= 2048);
}

function reviewDocument(packet) {
  return [
    packet.headline, packet.dek, 'AI-assisted draft',
    ...packet.paragraphs.map((row) => row.kind + '\n' + row.text + '\nEvidence: ' + row.evidenceIds.join(', ')),
    'Sources\n' + packet.evidence.map(({ id, url }) => id + ' ' + url).join('\n'),
    'Fact check\n' + (Array.isArray(packet.factCheck?.checks) ? packet.factCheck.checks.map((entry) =>
      String(entry?.unitId) + ': ' + String(entry?.verdict) + ' — ' + String(entry?.explanation)).join('\n') : 'Pending'),
  ].join('\n\n');
}

async function botRequest(env, method, body) {
  let response;
  try {
    response = await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/' + method, {
      method: 'POST', body, signal: AbortSignal.timeout(12_000), redirect: 'manual',
    });
  } catch {
    throw new Error('telegram-connection-failed');
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) {
    const description = typeof result?.description === 'string' ? result.description : '';
    const status = result?.error_code ?? response.status;
    if (status === 401 || status === 404) throw new Error('telegram-token-rejected');
    if (/chat not found/i.test(description)) throw new Error('telegram-chat-unavailable');
    if (status === 403 && result) throw new Error('telegram-bot-blocked');
    if (status === 400 && result) throw new Error('telegram-request-invalid');
    if (status === 429) throw new Error('telegram-rate-limited');
    throw new Error('telegram-connection-failed');
  }
  return result.result;
}

function reviewButtons(revision) {
  return JSON.stringify({ inline_keyboard: [[
    { text: 'Approve', callback_data: 'a:' + revision },
    { text: 'Edit', callback_data: 'e:' + revision },
    { text: 'Reject', callback_data: 'r:' + revision },
  ]] });
}

async function deliver(env, revision, packet, factCheckPassed, autoPublish) {
  const form = new FormData();
  form.set('chat_id', env.TELEGRAM_CHAT_ID);
  form.set('protect_content', 'true');
  form.set('document', new Blob([reviewDocument(packet)], { type: 'text/plain' }), 'editorial-draft.txt');
  const directions = packet.testOnly ? packet.dek : factCheckPassed
    ? (autoPublish ? 'Publishes after five minutes unless you request edits or reject.'
      : 'Approve after checking the facts and sources. The five-minute deadline cannot publish this draft automatically.')
    : 'Fact checks need attention. Open the attached report before choosing an action.';
  form.set('caption', packet.sport + ' editorial review\n' + packet.headline + '\n' + directions);
  form.set('reply_markup', reviewButtons(revision));
  const result = await botRequest(env, 'sendDocument', form);
  if (!Number.isSafeInteger(result?.message_id)) throw new Error('Telegram delivery could not be confirmed.');
  return result.message_id;
}

function allChecksPassed(packet) {
  const checks = packet.factCheck?.checks;
  if (packet.status !== 'needs-human-verification' || packet.factCheck?.scope !== 'supplied-evidence' ||
      packet.factCheck?.risk !== 'routine' || !Array.isArray(checks) ||
      checks.length !== packet.paragraphs.length + 2) return false;
  const ids = new Set(checks.filter((entry) => entry?.verdict === 'supported').map(({ unitId }) => unitId));
  return ids.has('headline') && ids.has('dek') &&
    packet.paragraphs.every((_, index) => ids.has('paragraph-' + (index + 1)));
}

export class EditorialReview {
  constructor(ctx, env) {
    this.storage = ctx.storage;
    this.env = env;
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/submit') return this.submit(await request.json());
    if (path === '/status') {
      const review = await this.storage.transaction((tx) => tx.get('review'));
      if (!review) return new Response(null, { status: 404 });
      const { status, testOnly, deliveredAt, deadline, decidedAt, expiredAt } = review;
      return Response.json({ status, testOnly, deliveredAt, deadline, decidedAt, expiredAt });
    }
    if (path === '/decision') {
      const input = await request.json();
      const status = await this.storage.transaction(async (tx) => {
        const original = await tx.get('review');
        if (!original || original.messageId !== input.messageId) return 'unavailable';
        if (input.action === 'approve' && !original.factCheckPassed &&
            ['awaiting-decision', 'manual-review'].includes(original.status)) return 'checks-unresolved';
        const updated = decide(original, { ...input, now: Date.now() });
        if (updated !== original) {
          await tx.put('review', updated);
          if (updated.status === 'approved' && !updated.testOnly && this.env.NEWSROOM_PUBLISH_ENABLED === 'true') {
            await tx.setAlarm(Date.now());
          } else if (updated.status === 'needs-edit' && updated.packet && this.env.NEWSROOM_GROQ_API_KEY?.trim()) {
            await tx.setAlarm(Date.now());
            return 'revision-queued';
          }
        }
        return updated.status;
      });
      return Response.json({ status });
    }
    return new Response(null, { status: 404 });
  }

  async submit({ revision, packet, independentlyVerified = false }) {
    const now = Date.now();
    const factCheckPassed = allChecksPassed(packet);
    const testOnly = packet.testOnly === true;
    const autoPublish = independentlyVerified && this.env.NEWSROOM_TIMEOUT_PUBLISH_ENABLED === 'true' &&
      this.env.NEWSROOM_PUBLISH_ENABLED === 'true';
    const article = factCheckPassed && !testOnly ? prepareArticle(packet, revision, now) : undefined;
    const reservation = await this.storage.transaction(async (tx) => {
      const original = await tx.get('review');
      if (original && (original.status !== 'delivering' || original.reservedAt > now - 30_000)) return original;
      const review = { revision, status: 'delivering', reservedAt: now, factCheckPassed, testOnly,
        independentlyVerified: autoPublish, ...(!testOnly && packet.evidence.every((note) => typeof note.fact === 'string') ? { packet } : {}) };
      await tx.put('review', review);
      return null;
    });
    if (reservation) return Response.json({ revision, status: reservation.status });
    let messageId;
    try {
      messageId = await deliver(this.env, revision, packet, factCheckPassed, autoPublish);
    } catch (error) {
      const reason = deliveryReasons.has(error?.message) ? error.message : 'telegram-delivery-failed';
      return Response.json({ reason }, { status: 503 });
    }
    const acceptedAt = Date.now();
    await this.storage.transaction(async (tx) => {
      const review = await tx.get('review');
      if (review.status !== 'delivering' || review.reservedAt !== now) return;
      const delivered = attachDelivery({ ...review, article }, messageId, acceptedAt);
      await tx.put('review', delivered);
      await tx.setAlarm(delivered.deadline);
    });
    return Response.json({ revision, status: 'awaiting-decision' }, { status: 201 });
  }

  async revise(review) {
    const packet = review.packet;
    let revised = review.revisionDraft;
    if (!revised) try {
      const brief = readBrief(JSON.stringify({
        sport: packet.sport,
        modelUseApproved: true,
        topic: 'Revise this editorial using only the supplied facts. Remove unsupported claims and keep analysis within the evidence.',
        evidence: packet.evidence,
      }));
      const generate = groqWriter(this.env.NEWSROOM_GROQ_API_KEY);
      const { headline, dek, paragraphs } = packet;
      revised = await checkDraft(await writeDraft(brief, generate, {
        headline, dek, paragraphs,
        checks: packet.factCheck?.checks?.filter(({ verdict }) => verdict !== 'supported') ?? [],
      }), generate);
    } catch {
      revised = undefined;
    }
    if (revised && allChecksPassed(revised)) {
      const revision = await draftRevision(revised);
      if (revision !== review.revision) {
        if (!review.revisionDraft) await this.storage.put('review', { ...review, revisionDraft: revised });
        const response = await reviewStub(this.env, revision).fetch('https://review.internal/submit', {
          method: 'POST', body: JSON.stringify({ revision, packet: revised }),
        });
        if (!response.ok) throw new Error('Revised draft delivery failed.');
        const { status } = await response.json();
        if (status === 'delivering') throw new Error('Revised draft delivery is still pending.');
        await this.storage.put('review', { ...review, packet: undefined, revisionDraft: undefined, replacement: revision });
        return;
      }
    }
    await this.storage.put('review', { ...review, packet: undefined });
    const form = new FormData();
    form.set('chat_id', this.env.TELEGRAM_CHAT_ID);
    form.set('message_id', String(review.messageId));
    form.set('caption', packet.sport + ' editorial review\n' + packet.headline +
      '\nThe automatic revision did not clear its checks. This draft remains unpublished.');
    await botRequest(this.env, 'editMessageCaption', form).catch(() => {});
  }

  async alarm() {
    const autoPublish = this.env.NEWSROOM_TIMEOUT_PUBLISH_ENABLED === 'true' &&
      this.env.NEWSROOM_PUBLISH_ENABLED === 'true';
    const review = await this.storage.transaction(async (tx) => {
      const original = await tx.get('review');
      if (!original) return null;
      const updated = original.status === 'approved' && original.decision === 'verified-timeout' && !autoPublish
        ? { ...original, status: 'manual-review', expiredAt: Date.now() }
        : expireReview(original, Date.now(), autoPublish);
      if (updated !== original) await tx.put('review', updated);
      return updated;
    });
    if (review?.status === 'needs-edit' && review.packet && this.env.NEWSROOM_GROQ_API_KEY?.trim()) {
      await this.revise(review);
    } else if (review?.status === 'approved' && !review.testOnly && this.env.NEWSROOM_PUBLISH_ENABLED === 'true') {
      const result = await commitArticle(review.article, this.env.NEWSROOM_GITHUB_TOKEN);
      await this.storage.transaction(async (tx) => {
        await tx.put('review', { ...review, status: 'committed', result, checks: 0 });
        await tx.setAlarm(Date.now() + 60_000);
      });
    } else if (review?.status === 'committed') {
      const live = await checkLiveArticle(review.article.url).catch(() => false);
      const checks = review.checks + 1;
      const status = live ? 'published' : checks >= 15 ? 'committed-unverified' : 'committed';
      await this.storage.transaction(async (tx) => {
        await tx.put('review', { ...review, status, checks });
        if (status === 'committed') await tx.setAlarm(Date.now() + 60_000);
      });
    }
  }
}

async function draftRevision(packet) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(packet)));
  return Array.from(new Uint8Array(digest).subarray(0, 16),
    (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function reviewStub(env, id) {
  return env.EDITORIAL_REVIEW.get(env.EDITORIAL_REVIEW.idFromName(id));
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/health') {
      return Response.json({ service: 'editorial-review', version: 'openligadb-attribution' }, {
        headers: { 'cache-control': 'no-store' },
      });
    }
    try {
      const statusPath = /^\/reviews\/([0-9a-f]{32})$/.exec(path);
      if (request.method === 'GET' && statusPath) {
        if (!await sameSecret(request.headers.get('x-newsroom-intake-token'), env.NEWSROOM_INTAKE_TOKEN)) {
          return new Response(null, { status: 403 });
        }
        return await reviewStub(env, statusPath[1]).fetch('https://review.internal/status');
      }
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      if (path === '/reviews' || path === '/staging-reviews') {
        if (!await sameSecret(request.headers.get('x-newsroom-intake-token'), env.NEWSROOM_INTAKE_TOKEN)) {
          return new Response(null, { status: 403 });
        }
        let packet;
        if (path === '/staging-reviews') {
          if (env.NEWSROOM_STAGING_ENABLED !== 'true') return new Response(null, { status: 404 });
          const input = await readJson(request, 1024);
          packet = stagingPacket(input?.runKey, input?.scenario);
        } else {
          packet = await readJson(request, 56_000);
        }
        if (!validPacket(packet)) return new Response(null, { status: 422 });
        if (path === '/staging-reviews') {
          if (!/^\d+:[A-Za-z0-9_-]+$/.test(env.TELEGRAM_BOT_TOKEN ?? '')) {
            return Response.json({ reason: 'bot-token-missing-or-malformed' }, { status: 503 });
          }
          if (typeof env.TELEGRAM_CHAT_ID !== 'string' || !/^\d+$/.test(env.TELEGRAM_CHAT_ID) ||
              env.TELEGRAM_EDITOR_ID !== env.TELEGRAM_CHAT_ID) {
            return Response.json({ reason: 'private-chat-bindings-invalid' }, { status: 503 });
          }
        }
        // Only an independent verifier may attest that this exact submission cleared its evidence and rights checks.
        const independentlyVerified = path === '/reviews' && !packet.testOnly && await sameSecret(
          request.headers.get('x-newsroom-verifier-token'), env.NEWSROOM_VERIFIER_TOKEN);
        const revision = await draftRevision(packet);
        return await reviewStub(env, revision).fetch('https://review.internal/submit', {
          method: 'POST', body: JSON.stringify({ revision, packet, independentlyVerified }),
        });
      }
      if (path === '/telegram') {
        if (!await sameSecret(request.headers.get('x-telegram-bot-api-secret-token'), env.TELEGRAM_WEBHOOK_SECRET)) {
          return new Response(null, { status: 403 });
        }
        const callback = (await readJson(request, 16_000))?.callback_query;
        const match = /^([aer]):([0-9a-f]{32})$/.exec(callback?.data ?? '');
        if (!match || String(callback?.from?.id) !== env.TELEGRAM_EDITOR_ID ||
            String(callback?.message?.chat?.id) !== env.TELEGRAM_CHAT_ID ||
            !Number.isSafeInteger(callback?.message?.message_id) || typeof callback?.id !== 'string') {
          return new Response(null, { status: 204 });
        }
        const response = await reviewStub(env, match[2]).fetch('https://review.internal/decision', {
          method: 'POST', body: JSON.stringify({ action: controls[match[1]], messageId: callback.message.message_id }),
        });
        const { status } = await response.json();
        const form = new FormData();
        form.set('callback_query_id', callback.id);
        form.set('text', statusText[status] ?? 'This draft still requires editorial review.');
        if (status === 'checks-unresolved') form.set('show_alert', 'true');
        await botRequest(env, 'answerCallbackQuery', form);
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
    } catch {
      return Response.json({ reason: 'worker-request-failed' }, { status: 503 });
    }
  },
};
