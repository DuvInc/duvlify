import type { APIRoute } from 'astro';
import { seo, site as siteConfig } from '../docs.config';
import { getFlatPages, getHomePage } from '../lib/navigation';
import { byId, getPublishedDocs } from '../lib/published';
import { toPageMarkdown } from '../lib/markdown';

/**
 * /llms-full.txt — the optional homepage, then every sidebar page's Markdown,
 * in one file. The companion to /llms.txt for assistants that would rather
 * read once than crawl.
 */
export const GET: APIRoute = async ({ site }) => {
  const entries = byId(await getPublishedDocs());
  const home = await getHomePage();
  const pages = [
    ...(home ? [home] : []),
    ...(await getFlatPages()).map(({ page }) => page),
  ].filter(page => {
    const entry = entries.get(page.id);
    return Boolean(entry && !entry.data.noindex);
  });

  const documents = pages.map(page =>
    toPageMarkdown(entries.get(page.id)!, { url: new URL(page.href, site).href }),
  );

  return new Response(
    [
      [
        `# ${siteConfig.name}`,
        '',
        `> ${siteConfig.description}`,
        ...(seo.agentInstructions.length ? ['', ...seo.agentInstructions] : []),
      ].join('\n'),
      ...documents,
    ].join('\n\n---\n\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
};
