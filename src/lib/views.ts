// src/lib/views.ts
import { kv } from '@vercel/kv';

/**
 * Returns the top N post IDs by view count, most-viewed first.
 * Returns an empty array gracefully if KV isn't set up yet or has no data —
 * so this never breaks the build before you've launched.
 */
export async function getTopViewedPostIds(limit = 4): Promise<string[]> {
  try {
    const results = await kv.zrange<string[]>('post-views', 0, limit - 1, { rev: true });
    return results ?? [];
  } catch {
    return [];
  }
}
