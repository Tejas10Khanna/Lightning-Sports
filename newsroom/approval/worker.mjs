import { attachDelivery, decide, expireReview } from './state.mjs';
import { checkLiveArticle, commitArticle, prepareArticle } from './publish.mjs';

const encoder = new TextEncoder();
const controls = { a: 'approve', e: 'edit', r: 'reject' };
const statusText = {
  approved: 'Approval recorded.',
  'needs-edit': 'Edit requested. Submit a revised draft for a new review.',
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
  const response = await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/' + method, {
    method: 'POST', body, signal: AbortSignal.timeout(12_000), redirect: 'error',
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error('Telegram rejected the request.');
  return result.result;
}

async function deliver(env, revision, packet, factCheckPassed) {
  const form = new FormData();
  form.set('chat_id', env.TELEGRAM_CHAT_ID);
  form.set('protect_content', 'true');
  form.set('document', new Blob([reviewDocument(packet)], { type: 'text/plain' }), 'editorial-draft.txt');
  form.set('caption', packet.sport + ' editorial review\n' + packet.headline +
    (factCheckPassed ? '\nConfirm facts, citations, and rights before approving.' : '\nHeld for editorial review.'));
  const buttons = [
    { text: 'Edit', callback_data: 'e:' + revision },
    { text: 'Reject', callback_data: 'r:' + revision },
  ];
  if (factCheckPassed) buttons.unshift({ text: 'Approve', callback_data: 'a:' + revision });
  form.set('reply_markup', JSON.stringify({ inline_keyboard: [buttons] }));
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
    if (path === '/decision') {
      const input = await request.json();
      const status = await this.storage.transaction(async (tx) => {
        const original = await tx.get('review');
        if (!original || original.messageId !== input.messageId) return 'unavailable';
        const updated = decide(original, { ...input, now: Date.now() });
        if (updated !== original) {
          await tx.put('review', updated);
          if (updated.status === 'approved' && this.env.NEWSROOM_PUBLISH_ENABLED === 'true') {
            await tx.setAlarm(Date.now());
          }
        }
        return updated.status;
      });
      return Response.json({ status });
    }
    return new Response(null, { status: 404 });
  }

  async submit({ revision, packet }) {
    const now = Date.now();
    const factCheckPassed = allChecksPassed(packet);
    const article = factCheckPassed ? prepareArticle(packet, revision, now) : undefined;
    const reservation = await this.storage.transaction(async (tx) => {
      const original = await tx.get('review');
      if (original && (original.status !== 'delivering' || original.reservedAt > now - 30_000)) return original;
      const review = { revision, status: 'delivering', reservedAt: now, factCheckPassed };
      await tx.put('review', review);
      return null;
    });
    if (reservation) return Response.json({ revision, status: reservation.status });
    const messageId = await deliver(this.env, revision, packet, factCheckPassed);
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

  async alarm() {
    const review = await this.storage.transaction(async (tx) => {
      const original = await tx.get('review');
      if (!original) return null;
      const updated = expireReview(original, Date.now());
      if (updated !== original) await tx.put('review', updated);
      return updated;
    });
    if (review?.status === 'approved' && this.env.NEWSROOM_PUBLISH_ENABLED === 'true') {
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

function reviewStub(env, id) {
  return env.EDITORIAL_REVIEW.get(env.EDITORIAL_REVIEW.idFromName(id));
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const path = new URL(request.url).pathname;
    try {
      if (path === '/reviews') {
        if (!await sameSecret(request.headers.get('x-newsroom-intake-token'), env.NEWSROOM_INTAKE_TOKEN)) {
          return new Response(null, { status: 403 });
        }
        const packet = await readJson(request, 56_000);
        if (!validPacket(packet)) return new Response(null, { status: 422 });
        const digest = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(packet)));
        const revision = Array.from(new Uint8Array(digest).subarray(0, 16),
          (byte) => byte.toString(16).padStart(2, '0')).join('');
        return await reviewStub(env, revision).fetch('https://review.internal/submit', {
          method: 'POST', body: JSON.stringify({ revision, packet }),
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
        await botRequest(env, 'answerCallbackQuery', form);
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
    } catch {
      return new Response('Newsroom request failed.', { status: 503 });
    }
  },
};
