import { pathToFileURL } from 'node:url';

export async function configureTelegram({ command, env, request = fetch }) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const username = (env.TELEGRAM_EXPECTED_BOT || '').replace(/^@/, '').toLowerCase();
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token ?? '') || !/^[a-z0-9_]{5,32}$/.test(username)) {
    throw new Error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_EXPECTED_BOT.');
  }
  if (!['discover', 'connect'].includes(command)) throw new Error('Choose discover or connect.');

  async function telegram(method, data = {}) {
    let response;
    try {
      response = await request('https://api.telegram.org/bot' + token + '/' + method, {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
    } catch {
      throw new Error('Telegram request failed during ' + method + '.');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Telegram returned HTTP ' + response.status + ' during ' + method + '.');
    }
    const responseBody = await response.json().catch(() => null);
    if (!responseBody?.ok) throw new Error('Telegram rejected ' + method + '.');
    return responseBody.result;
  }

  const bot = await telegram('getMe');
  if (!bot?.is_bot || bot.username?.toLowerCase() !== username) {
    throw new Error('The token belongs to a different bot.');
  }
  const webhook = await telegram('getWebhookInfo');
  if (typeof webhook?.url !== 'string') throw new Error('Telegram did not provide webhook status.');

  if (command === 'discover') {
    if (webhook.url) throw new Error('Chat discovery needs a bot without an active webhook.');
    const updates = await telegram('getUpdates', { limit: 100, timeout: 0 });
    if (!Array.isArray(updates)) throw new Error('Telegram did not provide pending updates.');
    const privateStarts = new Map();
    for (const update of updates) {
      const message = update?.message;
      if (message?.chat?.type === 'private' &&
          Number.isSafeInteger(message.chat.id) && Number.isSafeInteger(message.from?.id) &&
          message.from.id === message.chat.id && /^\/start(?:\s|$)/.test(message.text ?? '')) {
        privateStarts.set(message.from.id, message.chat.id);
      }
    }
    if (privateStarts.size !== 1) {
      throw new Error('Chat discovery requires exactly one private chat with a pending /start message.');
    }
    const [[editorId, chatId]] = privateStarts;
    return { bot: bot.username, TELEGRAM_EDITOR_ID: String(editorId), TELEGRAM_CHAT_ID: String(chatId) };
  }

  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  let base;
  try {
    base = new URL(env.NEWSROOM_APPROVAL_URL);
  } catch {
    throw new Error('Set NEWSROOM_APPROVAL_URL to the HTTPS Worker base URL.');
  }
  if (base.protocol !== 'https:' || base.username || base.password ||
      base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Set NEWSROOM_APPROVAL_URL to the HTTPS Worker base URL.');
  }
  if (!/^[A-Za-z0-9_-]{24,256}$/.test(secret ?? '')) {
    throw new Error('Set TELEGRAM_WEBHOOK_SECRET to the same 24–256 character value as the Worker secret.');
  }
  const url = new URL('/telegram', base).href;
  if (webhook.url && webhook.url !== url) {
    throw new Error('This bot already has a webhook at a different URL.');
  }
  if (await telegram('setWebhook', { url, secret_token: secret, allowed_updates: ['callback_query'] }) !== true) {
    throw new Error('Telegram did not confirm webhook registration.');
  }
  const confirmed = await telegram('getWebhookInfo');
  if (confirmed?.url !== url || confirmed.allowed_updates?.length !== 1 ||
      confirmed.allowed_updates[0] !== 'callback_query') {
    throw new Error('Telegram did not confirm the intended callback configuration.');
  }
  return { bot: bot.username, webhook: confirmed.url };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await configureTelegram({ command: process.argv[2], env: process.env });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
