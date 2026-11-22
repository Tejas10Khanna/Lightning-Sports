import assert from 'node:assert/strict';
import test from 'node:test';
import { attachDelivery, decide, expireReview } from './state.mjs';
import { sendForReview } from './submit.mjs';
import worker, { EditorialReview } from './worker.mjs';

test('deadline starts after delivery and timeouts stay in manual review', () => {
  const deliveredAt = 50_000;
  const initial = attachDelivery({ factCheckPassed: true }, 9, deliveredAt);
  assert.equal(initial.deadline, deliveredAt + 300_000);
  assert.equal(expireReview(initial, initial.deadline - 1), initial);
  const timedOut = expireReview(initial, initial.deadline);
  assert.equal(timedOut.status, 'manual-review');
  assert.equal(decide(timedOut, { action: 'approve', messageId: 9, now: initial.deadline }).status, 'approved');
});

test('edit and reject stop a review and a held draft cannot be approved', () => {
  const initial = attachDelivery({ factCheckPassed: false }, 9, 0);
  assert.equal(decide(initial, { action: 'approve', messageId: 9, now: 1 }), initial);
  assert.equal(decide(initial, { action: 'reject', messageId: 8, now: 1 }), initial);
  for (const [action, expected] of [['edit', 'needs-edit'], ['reject', 'rejected']]) {
    const done = decide(initial, { action, messageId: 9, now: 1 });
    assert.equal(done.status, expected);
    assert.equal(expireReview(done, initial.deadline), done);
    assert.equal(decide(done, { action: 'approve', messageId: 9, now: 2 }), done);
  }
});

test('a trusted submission sends a protected attachment and binds decisions to the editor and message', async (t) => {
  const deliveries = [];
  const responses = [];
  const scheduled = [];
  const instances = new Map();
  const env = {
    NEWSROOM_INTAKE_TOKEN: 'intake-token',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-token',
    TELEGRAM_BOT_TOKEN: '1234:mocked-bot',
    TELEGRAM_EDITOR_ID: '42',
    TELEGRAM_CHAT_ID: '42',
  };
  env.EDITORIAL_REVIEW = {
    idFromName: (name) => name,
    get(id) {
      if (!instances.has(id)) {
        const data = new Map();
        const tx = {
          get: (key) => data.get(key),
          put: (key, value) => data.set(key, value),
          setAlarm: (deadline) => scheduled.push(deadline),
        };
        instances.set(id, new EditorialReview({ storage: { transaction: (run) => run(tx) } }, env));
      }
      return { fetch: (url, options) => instances.get(id).fetch(new Request(url, options)) };
    },
  };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url, /^https:\/\/api\.telegram\.org\/bot1234:mocked-bot\//);
    if (url.endsWith('/sendDocument')) {
      deliveries.push(options.body);
      return Response.json({ ok: true, result: { message_id: 11 } });
    }
    assert.match(url, /\/answerCallbackQuery$/);
    responses.push(options.body.get('text'));
    return Response.json({ ok: true, result: true });
  });
  const packet = {
    status: 'needs-human-verification', sport: 'Cricket', headline: 'Example final', dek: 'A close finish.',
    paragraphs: Array.from({ length: 4 }, () => ({ kind: 'analysis', text: 'Example analysis.', evidenceIds: ['E1'] })),
    evidence: [
      { id: 'E1', url: 'https://example.test/score' },
      { id: 'E2', url: 'https://example.test/timeline' },
    ],
    factCheck: {
      scope: 'supplied-evidence', risk: 'routine',
      checks: ['headline', 'dek', 'paragraph-1', 'paragraph-2', 'paragraph-3', 'paragraph-4']
        .map((unitId) => ({ unitId, verdict: 'supported', explanation: 'Example check.' })),
    },
  };
  const call = (path, header, token, body) => worker.fetch(
    new Request('https://newsroom.example' + path, {
      method: 'POST', headers: { [header]: token }, body: JSON.stringify(body),
    }), env);
  const post = (token) => call('/reviews', 'x-newsroom-intake-token', token, packet);
  assert.equal((await post('wrong')).status, 403);
  const before = Date.now();
  const delivery = await post('intake-token');
  assert.equal(delivery.status, 201);
  const { revision } = await delivery.json();
  assert.match(revision, /^[0-9a-f]{32}$/);
  assert.ok(scheduled[0] >= before + 300_000);
  assert.equal(deliveries[0].get('protect_content'), 'true');
  assert.match(await deliveries[0].get('document').text(), /https:\/\/example.test\/score/);
  assert.deepEqual(JSON.parse(deliveries[0].get('reply_markup')).inline_keyboard[0].map(({ text }) => text),
    ['Approve', 'Edit', 'Reject']);
  assert.equal((await post('intake-token')).status, 200);
  assert.equal(deliveries.length, 1);

  const callback = (token, editor, message, action, target = revision) => call('/telegram', 'x-telegram-bot-api-secret-token', token, {
    callback_query: { id: 'click', data: action + ':' + target, from: { id: editor },
      message: { chat: { id: 42 }, message_id: message } },
  });
  assert.equal((await callback('wrong', 42, 11, 'a')).status, 403);
  assert.equal((await callback('webhook-token', 43, 11, 'a')).status, 204);
  assert.equal(responses.length, 0);
  await callback('webhook-token', 42, 12, 'a');
  assert.notEqual(responses.at(-1), 'Approval recorded.');
  await callback('webhook-token', 42, 11, 'a');
  assert.equal(responses.at(-1), 'Approval recorded.');
  await callback('webhook-token', 42, 11, 'r');
  assert.equal((await (await post('intake-token')).json()).status, 'approved');

  const startStaging = () => call('/staging-reviews', 'x-newsroom-intake-token', 'intake-token', {
    runKey: '123-1', scenario: 'approve',
  });
  assert.equal((await startStaging()).status, 404);
  env.NEWSROOM_STAGING_ENABLED = 'true';
  env.TELEGRAM_CHAT_ID = '43';
  const badBindings = await startStaging();
  assert.equal(badBindings.status, 503);
  assert.deepEqual(await badBindings.json(), { reason: 'private-chat-bindings-invalid' });
  env.TELEGRAM_CHAT_ID = '42';
  env.NEWSROOM_PUBLISH_ENABLED = 'true';
  env.NEWSROOM_GITHUB_TOKEN = 'must-not-be-used';
  const staged = await startStaging();
  assert.equal(staged.status, 201);
  const { revision: testRevision } = await staged.json();
  assert.match(deliveries.at(-1).get('caption'), /STAGING ONLY.*approve/);
  const status = (token) => worker.fetch(new Request('https://newsroom.example/reviews/' + testRevision, {
    headers: { 'x-newsroom-intake-token': token },
  }), env);
  assert.equal((await status('wrong')).status, 403);
  const alarmsBeforeApproval = scheduled.length;
  assert.equal((await callback('webhook-token', 42, 11, 'a', testRevision)).status, 204);
  assert.equal(scheduled.length, alarmsBeforeApproval);
  await instances.get(testRevision).alarm();
  const stagedStatus = await (await status('intake-token')).json();
  assert.equal(stagedStatus.status, 'approved');
  assert.equal(stagedStatus.testOnly, true);
  assert.equal(stagedStatus.deadline - stagedStatus.deliveredAt, 300_000);
  assert.equal(stagedStatus.article, undefined);
});

test('the submission client skips insufficient evidence and sends credentials only as a header', async () => {
  assert.equal(await sendForReview({ status: 'insufficient-evidence' }, {}), 'insufficient-evidence');
  const options = {
    url: 'https://review.example', token: 'intake-token',
    request: async (url, request) => {
      assert.equal(url.href, 'https://review.example/reviews');
      assert.equal(request.headers['x-newsroom-intake-token'], 'intake-token');
      assert.ok(!request.body.includes('intake-token'));
      return Response.json({ status: 'awaiting-decision' });
    },
  };
  assert.equal(await sendForReview({ status: 'needs-human-verification' }, options), 'awaiting-decision');
});
