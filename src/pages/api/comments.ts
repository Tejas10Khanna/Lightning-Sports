
// src/pages/api/comments.ts
// GET  /api/comments?postId=... -> { comments: [...] }
// POST /api/comments             -> { ok: true }
import type { APIRoute } from 'astro';
import { kv } from '@vercel/kv';
export const prerender = false;

const clean = (s: any, max: number) => String(s ?? '').trim().slice(0, max);

export const GET: APIRoute = async ({ url }) => {
  try {
    const postId = url.searchParams.get('postId');
    if (!postId) return new Response(JSON.stringify({ comments: [] }), { status: 200, headers: {'Content-Type':'application/json'} });
    const raw = await kv.lrange<any>(`comments:${postId}`, 0, 199);
    const comments = (raw || []).map((r) => typeof r === 'string' ? JSON.parse(r) : r).reverse();
    return new Response(JSON.stringify({ comments }), { status: 200, headers: {'Content-Type':'application/json'} });
  } catch (e) {
    return new Response(JSON.stringify({ comments: [] }), { status: 200, headers: {'Content-Type':'application/json'} });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const { postId, name, team, body } = await request.json();
    if (!postId || !name || !body) return new Response('missing fields', { status: 400 });

    // Very light rate limit — max 4 comments per postId per 30s per IP.
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon';
    const rateKey = `rl:comm:${postId}:${ip}`;
    const count = await kv.incr(rateKey);
    if (count === 1) await kv.expire(rateKey, 30);
    if (count > 4) return new Response('slow down', { status: 429 });

    const entry = {
      name: clean(name, 40),
      team: clean(team, 30),
      body: clean(body, 800),
      at: new Date().toISOString(),
    };
    await kv.rpush(`comments:${postId}`, JSON.stringify(entry));
    await kv.ltrim(`comments:${postId}`, -300, -1);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: {'Content-Type':'application/json'} });
  } catch (e) {
    return new Response('error', { status: 500 });
  }
};