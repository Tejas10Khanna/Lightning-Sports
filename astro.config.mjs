import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel/serverless';

export default defineConfig({
  // 'hybrid' keeps articles static, but allows specific pages to be live!
  output: 'hybrid', 
  adapter: vercel(),
});