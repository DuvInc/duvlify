import type { APIRoute } from 'astro';
import { seo, site as siteConfig } from '../docs.config';
import { lastModifiedFor } from '../lib/last-modified';
import { markdownUrl } from '../lib/markdown-url';
import { getFlatPages, getHomePage } from '../lib/navigation';
import { byId, getPublishedDocs } from '../lib/published';

/**
 * /updates.xml — the pages that changed most recently, newest first.
 *
 * The sitemap already carries a `lastmod` per page, but it is a flat list of
 * several hundred entries with no ordering: reading it tells you nothing until
 * you have parsed all of it and sorted it yourself. A feed answers the question
 * both search engines and agents actually ask on a return visit — "what is new
 * since I was last here" — in one small document, and it is the format they
 * already have a poller for.
 *
 * Each entry links to the page and, in a second `rel="alternate"` link, to its
 * Markdown, so a subscriber can fetch the changed content without a second
 * round trip to work out where it lives.
 *
 * Atom rather than RSS: it requires the update timestamp this feed exists to
 * publish, where RSS 2.0 has only an optional publication date.
 */

/** Enough to see a release's worth of changes; not the whole corpus again. */
const MAX_ENTRIES = 40;

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const GET: APIRoute = async ({ site }) => {
  const entries = byId(await getPublishedDocs());
  const home = await getHomePage();
  const pages = [...(home ? [home] : []), ...(await getFlatPages()).map(({ page }) => page)];

  const updated = pages
    /* A noindex page is reachable on purpose but must not be broadcast, for the
       same reason it is kept out of the sitemap. */
    .filter(page => !entries.get(page.id)?.data.noindex)
    .map(page => {
      const entry = entries.get(page.id)!;
      return { page, entry, modified: lastModifiedFor(entry) };
    })
    /* A page with no date at all — no commit, no `updated:`, no `published:` —
       has nothing to say about freshness and is left out rather than sorted to
       one end on a guess. */
    .filter((item): item is typeof item & { modified: Date } => Boolean(item.modified))
    .sort((a, b) => b.modified.getTime() - a.modified.getTime())
    .slice(0, MAX_ENTRIES);

  const feedUrl = new URL('/updates.xml', site).href;
  /* The feed's own timestamp is its newest entry, not the build time: a deploy
     that changed no content must not announce itself as an update. */
  const feedUpdated = updated[0]?.modified.toISOString() ?? new Date(0).toISOString();

  const items = updated.map(({ page, entry, modified }) => {
    const url = new URL(page.href, site).href;
    return [
      '  <entry>',
      `    <id>${url}</id>`,
      `    <title>${escape(entry.data.title)}</title>`,
      `    <link rel="alternate" type="text/html" href="${url}" />`,
      `    <link rel="alternate" type="text/markdown" href="${markdownUrl(url)}" />`,
      `    <updated>${modified.toISOString()}</updated>`,
      `    <summary>${escape(entry.data.description)}</summary>`,
      '  </entry>',
    ].join('\n');
  });

  return new Response(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<feed xmlns="http://www.w3.org/2005/Atom">',
      `  <id>${feedUrl}</id>`,
      `  <title>${escape(siteConfig.name)} documentation — recently updated</title>`,
      `  <subtitle>${escape(siteConfig.description)}</subtitle>`,
      `  <link rel="self" type="application/atom+xml" href="${feedUrl}" />`,
      `  <link rel="alternate" type="text/html" href="${new URL(siteConfig.home, site).href}" />`,
      `  <updated>${feedUpdated}</updated>`,
      `  <author><name>${escape(seo.organization.name)}</name></author>`,
      ...items,
      '</feed>',
      '',
    ].join('\n'),
    { headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' } },
  );
};
