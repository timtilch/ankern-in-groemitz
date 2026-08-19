import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.ankern-groemitz.de',
  integrations: [sitemap()],
  trailingSlash: 'never'
});
