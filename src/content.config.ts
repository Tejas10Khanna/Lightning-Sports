import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/posts" }),
  
  // 1. Tell Astro to look for the WordPress format
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    categories: z.array(z.string()).default(['uncategorized']), 
    author: z.string().default('Tejas Khanna'),
  })
  
  // 2. Transform the data before Claude's templates see it
  .transform((data) => ({
    ...data,
    // Grab the last item in the array (e.g., "football") and assign it to a new singular 'category' variable
    category: data.categories[data.categories.length - 1], 
  })),
});

export const collections = { posts };