import { defineConfig, fontProviders } from 'astro/config';
import mdx from '@astrojs/mdx';
import { unified } from '@astrojs/markdown-remark';
import { basePath, theme } from './src/docs.config';
import { rehypeCodeChrome, shikiCodeMeta } from './src/lib/rehype-code-chrome';
import { rehypeImages } from './src/lib/rehype-images';
import { rehypeWrapTables } from './src/lib/rehype-wrap-tables';
import { remarkMermaid } from './src/lib/remark-mermaid';
import { remarkVideoEmbed } from './src/lib/remark-video-embed';
import { loadEnvFile } from './scripts/env-file.mjs';
import { PLACEHOLDER_ORIGIN, warnOnPlaceholderOrigin } from './scripts/check-origin.mjs';

/*
 * Before `site` is read, because this file is evaluated to build the module graph
 * and is therefore outside the one Vite applies `.env` to. Without it `.env` is
 * write-only as far as the build is concerned: SITE_URL sits in the file exactly
 * where `.env.example` says to put it, and every canonical tag still names the
 * placeholder.
 */
loadEnvFile(import.meta.dirname);

export default defineConfig({
  /**
   * The canonical origin. Overridden per environment with SITE_URL, because
   * canonical links, the sitemap and llms.txt all have to name the real host.
   * Read from the shell first, then `.env` — see the loader above.
   *
   * The fallback is a placeholder on purpose — replace it with your own origin
   * before the first deploy. It is not cosmetic: this value is what the sitemap,
   * the canonical tags, llms.txt and the agent manifest all print, so leaving it
   * wrong publishes a site that points every crawler and every agent at a host
   * that is not yours. `npm run deploy` refuses to ship a build that still names
   * it; see scripts/check-origin.mjs.
   */
  site: process.env.SITE_URL || PLACEHOLDER_ORIGIN,

  /*
   * Kept in step with `site.basePath`, which is the value everything else
   * reads. Astro's `base` covers exactly one thing the rest of the codebase
   * cannot: the URLs Astro itself emits for the fingerprinted bundle, the
   * self-hosted fonts and any imported image.
   *
   * That split is worth knowing, because it is a trap. `base` does *not* move
   * anything inside `dist/`, and it does *not* touch the links this site builds
   * from `hrefFor`. Setting only `base` therefore prefixes the stylesheet and
   * the script while leaving every page link alone: the site builds, renders its
   * text, and loads with no CSS and no JavaScript. Setting only `basePath` does
   * the reverse. They move together or not at all, which is why both read from
   * one constant. A test asserts that every referenced asset exists.
   */
  base: basePath || undefined,

  output: 'static',
  trailingSlash: 'never',

  /**
   * `astro dev` / `astro preview` otherwise always bind 4321, regardless of any
   * port a launch config names — there's no default port-from-environment
   * behaviour in Astro's CLI, only an explicit `--port` flag. With two
   * documentation repos sharing this file's config, that's a guaranteed
   * collision the moment both run at once. Honouring `PORT` here is what lets
   * each instance actually get the separate port it's assigned.
   */
  server: { port: process.env.PORT ? Number(process.env.PORT) : 4321 },

  /**
   * Self-hosted webfonts. Astro downloads the family at build time, emits the
   * @font-face rules and preloads, and exposes the stack as a CSS variable —
   * so there is no render-blocking round trip to a third-party font CDN.
   */
  fonts: [
    {
      name: theme.font.sans,
      cssVariable: theme.font.sansVariable,
      provider: fontProviders.google(),
      weights: [...theme.font.sansWeights],
      styles: ['normal'],
      subsets: ['latin'],
      display: 'swap',
    },
  ],

  markdown: {
    /**
     * Both themes are emitted as --shiki-light / --shiki-dark custom properties.
     * `defaultColor: false` stops Shiki inlining a single theme's colours, which
     * would otherwise override our dark mode. styles/components.css picks the
     * variable to use; the code surface itself stays ours.
     */
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
      transformers: [shikiCodeMeta],
    },
    /**
     * The remark/rehype pipeline, declared explicitly. Astro's top-level
     * `remarkPlugins` / `rehypePlugins` keys are deprecated in favour of this.
     *
     * Ordering matters: remarkMermaid lifts diagram fences out *before*
     * highlighting, because Shiki would tokenise the definition into spans and
     * Mermaid needs the raw text. remarkVideoEmbed can run either side of it —
     * the two never touch the same node — so it sits after by convention only.
     * The rehype plugins then run after both.
     */
    processor: unified({
      remarkPlugins: [remarkMermaid, remarkVideoEmbed],
      rehypePlugins: [rehypeCodeChrome, rehypeWrapTables, rehypeImages],
    }),
  },

  /*
   * No Content-Security-Policy, deliberately.
   *
   * A useful CSP here would need a strict `script-src` (the directive that
   * actually stops XSS) alongside a permissive `style-src-elem`, because
   * Mermaid draws a diagram by injecting a <style> element and setting `style`
   * attributes on every shape — CSS generated at runtime from the current
   * colour mode, so nothing that can be hashed ahead of time.
   *
   * Astro's CSP API cannot express that split: it rejects `style-src-*` in
   * `directives`, and its own generated hashes land on `style-src`, where the
   * spec says a hash makes `'unsafe-inline'` be ignored. Measured under the
   * closest achievable policy: ~200 blocked style applications per render and
   * every diagram node drawn as a solid black box.
   *
   * Shipping a policy that breaks a documented feature is worse than shipping
   * none, and one loose enough to work would be `unsafe-inline` throughout,
   * which stops nothing. HSTS and the other security headers are set in
   * public/_headers. This becomes worth revisiting if diagrams are ever
   * pre-rendered to static SVG at build time — that would remove both the
   * runtime styles and the last large JavaScript payload at once.
   */

  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  integrations: [mdx(), warnOnPlaceholderOrigin()],
});
