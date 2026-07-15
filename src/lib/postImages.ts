// src/lib/postImages.ts
//
// Automatically resolves the first image referenced in a post's raw markdown
// (e.g. ![](images/flag-india.jpg)) to a real, servable URL.
// Requires: all post images live in src/content/posts/images/
// You never need to import or reference an image by hand — this scans them all.

const imageModules = import.meta.glob('/src/content/posts/images/*', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

// Build a lookup: "flag-india.jpg" -> resolved build URL
const imagesByFilename: Record<string, string> = {};
for (const [fullPath, url] of Object.entries(imageModules)) {
  const filename = fullPath.split('/').pop()!;
  imagesByFilename[filename] = url;
}

/**
 * Given a post's raw markdown body, returns the URL of the first image
 * referenced in it, or null if none is found.
 */
export function getFirstImage(markdownBody: string | undefined): string | null {
  if (!markdownBody) return null;
  const match = markdownBody.match(/!\[[^\]]*\]\(([^)]+)\)/);
  if (!match) return null;

  const filename = match[1].trim().split('/').pop()!;
  return imagesByFilename[filename] ?? null;
}
