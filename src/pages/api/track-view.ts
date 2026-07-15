// src/pages/api/track-view.ts
//
// Requires Vercel KV set up on your project (Vercel dashboard → Storage → KV,
// then `npm install @vercel/kv` — it auto-injects the connection env vars).
// This just increments a counter per postId. Cheap, fast, no other backend needed.

import type { APIRoute } from 'astro';
import { kv } from '@vercel/kv';

export const prerender = false; // must run as a live serverless function

export const POST: APIRoute = async ({ request }) => {
  try {
    const { postId } = await request.json();
    if (!postId) return new Response('Missing postId', { status: 400 });

    await kv.zincrby('post-views', 1, postId);
    return new Response('ok', { status: 200 });
  } catch {
    return new Response('error', { status: 500 });
  }
};
