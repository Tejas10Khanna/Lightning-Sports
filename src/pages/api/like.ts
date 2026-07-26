// src/pages/api/like.ts
import type { APIRoute } from 'astro';
import { kv } from '@vercel/kv';
export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { postId, delta } = await request.json();
    if (!postId) return new Response('missing postId', { status: 400 });
    const step = delta === -1 ? -1 : 1;
    const next = await kv.incrby(`likes:${postId}`, step);
    if (next < 0) await kv.set(`likes:${postId}`, 0);
    return new Response(JSON.stringify({ likes: Math.max(0, next) }), { status: 200, headers: {'Content-Type':'application/json'} });
  } catch (e) {
    return new Response('error', { status: 500 });
  }
};