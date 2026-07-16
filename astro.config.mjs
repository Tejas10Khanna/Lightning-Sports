import { defineConfig } from 'astro/config';
// We just removed '/serverless' from this line:
import vercel from '@astrojs/vercel'; 

export default defineConfig({
  output: 'hybrid',
  adapter: vercel(),
});