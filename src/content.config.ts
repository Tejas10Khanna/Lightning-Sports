import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({
    pattern: "**/*.md",
    base: "./src/content/posts"
  }),

  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    categories: z.array(z.string()).default(['uncategorized']),
    author: z.string().trim().optional(),
    aiAssisted: z.boolean().default(false),
    mainSport: z.union([z.string(), z.array(z.string())]).optional(),
    rawTags: z.array(z.string()).optional(),
    featuredQuote: z.string().trim().optional(),
    dek: z.string().trim().optional(),
    tags: z.array(z.string()).optional(),
  }).refine((data) => !data.aiAssisted || Boolean(data.author), {
    path: ['author'],
    message: 'AI-assisted articles require an explicit byline.',
  }).transform((data) => {
    const article = {
      ...data,
      author: data.author || 'Tejas Khanna',
      rawTags: data.rawTags ?? data.categories,
    };
    const sports = [data.mainSport ?? []].flat();
    const selectedSports = [...new Set(sports.map((sport) => sport.trim()).filter(Boolean))];

    if (selectedSports.length > 0) {
      return {
        ...article,
        category: selectedSports.length === 1 ? selectedSports[0] : selectedSports,
      };
    }

    // 2. Otherwise, use the fallback smart scanner
    const tags = data.categories.map(c => c.toLowerCase());
    const title = data.title.toLowerCase();
    let computedSport = 'More Sports';

    if (tags.some(t => t.includes('announcement') || t.includes('update'))) {
      computedSport = 'Announcement';
    } else if (tags.some(t => t.includes('cricket') || t.includes('ipl')) || title.includes('warne') || title.includes('ipl')) {
      computedSport = 'Cricket';
    } else if (tags.some(t => t.includes('football') || t.includes('uefa')) || title.includes('messi') || title.includes('barcelona')) {
      computedSport = 'Football';
    } else if (tags.some(t => t.includes('para')) || title.includes('para')) {
      computedSport = 'Paralympics';
    } else if (tags.some(t => t.includes('winter')) || title.includes('winter')) {
      computedSport = 'Winter Olympics';
    } else if (tags.some(t => t.includes('olympic')) || title.includes('olympic') || title.includes('tokyo')) {
      computedSport = 'Olympics';
    } else if (tags.some(t => t.includes('commonwealth')) || title.includes('commonwealth')) {
      computedSport = 'Commonwealth Games';
    } else if (tags.some(t => t.includes('tennis')) || title.includes('nadal') || title.includes('wimbledon')) {
      computedSport = 'Tennis';
    }

    return {
      ...article,
      category: computedSport,
    };
  }),
});

export const collections = { posts };
