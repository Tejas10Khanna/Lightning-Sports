
// src/pages/api/generate-image.ts
//
// AI hero image generator (Gemini Nano Banana - gemini-2.5-flash-image).
// Meant for writers to hit from a tiny admin tool or via a curl command
// when drafting a new article. Returns a base64 PNG.
//
// Setup:
//   1. Enable Gemini API and get a key: https://aistudio.google.com/app/apikey
//   2. In Vercel > Project Settings > Environment Variables, add:
//         GEMINI_API_KEY = <your key>
//   3. Call:  POST /api/generate-image  { \"prompt\": \"cinematic wide shot of ...\" }
//
// It uses the current-gen \"nano banana\" image model. If Google rotates the model
// name later, only this file needs updating.
import type { APIRoute } from 'astro';
export const prerender = false;

const MODEL = 'gemini-2.5-flash-image';

export const POST: APIRoute = async ({ request }) => {
  try {
    const key = import.meta.env.GEMINI_API_KEY;
    if (!key) return new Response('missing GEMINI_API_KEY', { status: 500 });

    const { prompt, sport } = await request.json();
    if (!prompt) return new Response('missing prompt', { status: 400 });

    // Tone the prompt to match our editorial voice + sport palette.
    const finalPrompt = [
      'Editorial sports magazine photograph, cinematic wide-lens composition,',
      'dramatic natural light, sharp focus, subtle film grain, muted saturated palette.',
      sport ? `Subject: ${sport} — ` : '',
      prompt,
      'No text, no watermark, no logos.',
    ].join(' ');

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: finalPrompt }] }],
          generationConfig: { responseModalities: ['IMAGE'] },
        }),
      }
    );
    const data = await res.json();
    const part = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    if (!part) return new Response(JSON.stringify({ error: 'no image', raw: data }), { status: 502, headers: {'Content-Type':'application/json'} });

    const b64 = part.inlineData.data;
    return new Response(JSON.stringify({ imageBase64: b64, mime: part.inlineData.mimeType || 'image/png' }), { status: 200, headers: {'Content-Type':'application/json'} });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'error' }), { status: 500, headers: {'Content-Type':'application/json'} });
  }
};