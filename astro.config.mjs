import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  // Changed from 'hybrid' to 'static'
  output: 'static', 
  adapter: vercel(),
});