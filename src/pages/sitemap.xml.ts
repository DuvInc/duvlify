import type { APIRoute } from 'astro';
import { withBase } from '../docs.config';
import { lastModifiedFor } from '../lib/last-modified';
import { getFlatPages, getHomePage } from '../lib/navigation';
import { byId, getPublishedDocs } from '../lib/published';

/**
 * One flat sitemap: the optional homepage first, then the docs in sidebar
 * order. A homepage is intentionally not a nav item, but it must be
 * discoverable just like every published documentation page.
 *
 * `lastmod` comes from each file's last commit rather than its mtime: a fresh
 * clone in CI stamps every file with the checkout time, which would claim the
 * entire site changed on every deploy. A freshness signal that always says
 * "everything, just now" is worse than none, because it gets discounted.
 *
 * `changefreq` and `priority` are deliberately absent. Google has said for
 * years that it ignores both, and emitting them only invites someone to spend
 * an afternoon tuning numbers nothing reads.
 */
export const GET: APIRoute = async ({ site }) => {
  const entries = byId(await getPublishedDocs());
  const home = await getHomePage();
  const pages = [
    ...(home ? [home] : []),
    ...(await getFlatPages()).map(({ page }) => page),
  ];

  const urls = pages
    /* A noindex page is reachable on purpose but must not be submitted. */
    .filter(page => !entries.get(page.id)?.data.noindex)
    .map(page => {
      const modified = lastModifiedFor(entries.get(page.id)!);
      return [
        '  <url>',
        `    <loc>${new URL(page.href, site).href}</loc>`,
        ...(modified ? [`    <lastmod>${modified.toISOString()}</lastmod>`] : []),
        '  </url>',
      ].join('\n');
    })
    .join('\n');

  return new Response(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      /* Renders as a readable page in a browser instead of raw XML. */
      `<?xml-stylesheet type="text/xsl" href="${withBase('/sitemap.xsl')}"?>`,
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      urls,
      '</urlset>',
      '',
    ].join('\n'),
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
};
