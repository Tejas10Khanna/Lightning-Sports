
// src/pages/api/subscribe.ts
// Newsletter signup with per-sport preferences. Stores in Vercel KV.
// Emails are captured only — actual delivery you can wire to Resend/SendGrid later
// via a nightly cron that reads `subscribers` and sends the alerts they opted into.
import type { APIRoute } from 'astro';
import { kv } from '@vercel/kv';
export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { email, alerts, weekly, sports } = await request.json();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return new Response('bad email', { status: 400 });
    if (!alerts && !weekly) return new Response('choose at least one', { status: 400 });

    const entry = {
      email: String(email).trim().toLowerCase(),
      alerts: !!alerts,
      weekly: !!weekly,
      sports: Array.isArray(sports) ? sports.slice(0, 20) : [],
      at: new Date().toISOString(),
    };

    // Deduplicate by email (SET, but preserve latest preferences)
    await kv.hset('subscribers', { [entry.email]: JSON.stringify(entry) });
    // Also push to an audit stream
    await kv.rpush('subscriber-log', JSON.stringify(entry));
    await kv.ltrim('subscriber-log', -1000, -1);

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: {'Content-Type':'application/json'} });
  } catch (e) {
    return new Response('error', { status: 500 });
  }
};