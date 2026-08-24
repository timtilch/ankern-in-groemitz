import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.ankern-groemitz.de',
  base: process.env.ASTRO_BASE || undefined,
  integrations: [sitemap()],
  trailingSlash: 'never'
});
