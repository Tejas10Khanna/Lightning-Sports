// src/pages/api/cron/update-trending.ts
//
// Runs once a day via Vercel Cron (configure in vercel.json — see below).
// Asks Gemini, with Google Search grounding, which of YOUR existing sport
// categories are most newsworthy today, and stores only an ordered list of
// category slugs. It never generates code or touches layout/design —
// it only decides priority order, which your homepage already knows how
// to render.

import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { kv } from '@vercel/kv';

export const prerender = false;

const GEMINI_API_KEY = import.meta.env.GEMINI_API_KEY; // set in Vercel project env vars

export const GET: APIRoute = async () => {
  try {
    const posts = await getCollection('posts');
    const categories = [...new Set(posts.map((p) => p.data.category))];

    const prompt = `Today's date is ${new Date().toISOString().slice(0, 10)}.
Here is a fixed list of sports categories: ${categories.join(', ')}.
Using current sports news, rank ONLY these categories from most to least
newsworthy today. Respond with strictly a JSON array of the category
strings, e.g. ["cricket","football"]. Do not invent new categories.`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }], // live search grounding
        }),
      }
    );

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';

    // Defensive parsing — if Gemini returns anything malformed, we keep
    // yesterday's order rather than break the homepage.
    let ranked: string[];
    try {
      ranked = JSON.parse(text.trim());
      if (!Array.isArray(ranked)) throw new Error('not an array');
      ranked = ranked.filter((c) => categories.includes(c));
    } catch {
      return new Response('Kept previous order — Gemini response unparseable', { status: 200 });
    }

    await kv.set('trending-category-order', ranked);
    return new Response(JSON.stringify({ ranked }), { status: 200 });
  } catch (err) {
    return new Response('error', { status: 500 });
  }
};
