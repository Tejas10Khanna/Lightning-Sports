import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({
    pattern: "**/*.md",
    base: "./src/content/posts"
  }),

  // THIS IS THE BLUEPRINT: We added 'dek' and 'tags' here
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    categories: z.array(z.string()).default(['uncategorized']),
    author: z.string().default('Tejas Khanna'),
    mainSport: z.string().optional(), // <-- THE MANUAL OVERRIDE SWITCH
    dek: z.string().optional(),       // <-- ADDED: Allows subtitles/summaries
    tags: z.array(z.string()).optional(), // <-- ADDED: Allows specific tags
  }).transform((data) => {
    
    // 1. If you manually set a category in the file, USE IT IMMEDIATELY AND SKIP EVERYTHING ELSE.
    if (data.mainSport) {
      return {
        ...data,
        category: data.mainSport,
        rawTags: data.categories
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
      ...data,
      category: computedSport,
      rawTags: data.categories
    };
  }),
});

export const collections = { posts };