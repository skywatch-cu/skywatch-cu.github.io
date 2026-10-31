import { defineConfig } from 'astro/config';

// Served from the org Pages root. When skywatch.colorado.edu is pointed here,
// change `site` and add public/CNAME.
export default defineConfig({
  site: 'https://skywatch-cu.github.io',
  trailingSlash: 'ignore',
});
