import assert from 'node:assert/strict';
import test from 'node:test';
import { configureTelegram } from './telegram-setup.mjs';

const env = {
  TELEGRAM_BOT_TOKEN: '1234:fake-test-token',
  TELEGRAM_EXPECTED_BOT: '@ExampleNewsroomBot',
  NEWSROOM_APPROVAL_URL: 'https://newsroom.example',
  TELEGRAM_WEBHOOK_SECRET: 'synthetic_secret_for_test_123',
};
const userStart = (id) => ({ message: { chat: { type: 'private', id }, from: { id }, text: '/start' } });
const bot = { username: 'ExampleNewsroomBot', is_bot: true };

function mockApi(steps) {
  return async (url, options) => {
    const step = steps.shift();
    assert.ok(step, 'Unexpected Telegram operation');
    assert.equal(url, 'https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/' + step[0]);
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    if (step[2]) assert.deepEqual(JSON.parse(options.body), step[2]);
    return Response.json({ ok: true, result: step[1] });
  };
}

test('identifies one private editor without revealing the token or message contents', async () => {
  const discovery = await configureTelegram({
    env, command: 'discover', request: mockApi([
      ['getMe', bot], ['getWebhookInfo', { url: '' }],
      ['getUpdates', [userStart(42), userStart(42), { message: { chat: { type: 'group' }, text: '/start' } }]],
    ]),
  });
  assert.deepEqual(discovery, { bot: 'ExampleNewsroomBot', TELEGRAM_EDITOR_ID: '42', TELEGRAM_CHAT_ID: '42' });
});

test('rejects a different bot, an ambiguous editor, or an existing webhook at another destination', async () => {
  await assert.rejects(configureTelegram({
    env, command: 'connect', request: mockApi([['getMe', { ...bot, username: 'OtherBot' }]]),
  }), /different bot/);
  await assert.rejects(configureTelegram({
    env, command: 'discover', request: mockApi([
      ['getMe', bot], ['getWebhookInfo', { url: '' }], ['getUpdates', [userStart(42), userStart(43)]],
    ]),
  }), /exactly one private chat/);
  await assert.rejects(configureTelegram({
    env, command: 'connect', request: mockApi([
      ['getMe', bot], ['getWebhookInfo', { url: 'https://other.example/webhook' }],
    ]),
  }), /different URL/);
});

test('sets only callback updates and verifies the exact Worker webhook', async () => {
  const url = 'https://newsroom.example/telegram';
  const webhook = await configureTelegram({
    env, command: 'connect', request: mockApi([
      ['getMe', bot], ['getWebhookInfo', { url: '' }],
      ['setWebhook', true, { url, secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['callback_query'] }],
      ['getWebhookInfo', { url, allowed_updates: ['callback_query'] }],
    ]),
  });
  assert.deepEqual(webhook, { bot: 'ExampleNewsroomBot', webhook: url });
});
