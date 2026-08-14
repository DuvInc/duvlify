import type { APIRoute } from 'astro';
import { agents, seo, site as siteConfig, withBase } from '../docs.config';
import { getNavigation } from '../lib/navigation';
import { hasOpenApiSpec, OPENAPI_PATH } from '../lib/openapi-spec';
import { byId, getPublishedDocs } from '../lib/published';

/**
 * /llms.txt — a map of the documentation for assistants, following the
 * llmstxt.org convention: an H1 title, a blockquote summary, then one H2
 * section per area with a linked list under it, and a final `## Optional`
 * section holding what a reader can safely skip.
 *
 * Links point at each page's `.md` source rather than its HTML, so anything
 * that follows them gets the content and none of the chrome. Two files, two
 * jobs: this one is the index, /llms-full.txt is the whole corpus.
 *
 * The structure is generated from the same navigation tree as the sidebar, so
 * it cannot list a page that does not exist or omit one that does.
 */
export const GET: APIRoute = async ({ site }) => {
  const tabs = await getNavigation();
  const entries = byId(await getPublishedDocs());

  const url = (path: string) => new URL(path, site).href;

  const sections = tabs.map(tab => {
    const links = tab.groups.flatMap(group =>
      group.pages
        .filter(page => !entries.get(page.id)?.data.noindex)
        .map(page => `- [${page.title}](${url(`${page.href}.md`)}): ${page.description}`),
    );
    /* Trailing blank line so the next `##` heading is separated from the list. */
    return `## ${tab.label}\n\n${links.join('\n')}\n`;
  });

  return new Response(
    [
      `# ${siteConfig.name}`,
      '',
      `> ${siteConfig.description}`,
      '',
      ...(seo.agentInstructions.length ? [...seo.agentInstructions, ''] : []),
      'Each link below is a page of this documentation as Markdown. The same path',
      'without the `.md` suffix serves the HTML version.',
      '',
      ...sections,
      '',
      '## Optional',
      '',
      `- [Full documentation in one file](${url(withBase('/llms-full.txt'))}): every page above, concatenated. Fetch this instead of crawling if you would rather read once.`,
      ...(hasOpenApiSpec
        ? [`- [OpenAPI description](${url(withBase(OPENAPI_PATH))}): the machine-readable API description the endpoint pages are generated from. Read it for exact parameter names, types and response schemas.`]
        : []),
      ...(agents.enabled
        ? [
            `- [MCP server](${url(withBase('/mcp'))}): this documentation as tools an agent can call — search it, list its pages, fetch one as Markdown. Add the URL as a remote MCP server.`,
            ...(agents.http
              ? [`- [HTTP API](${url(withBase('/api/docs'))}): the same tools as plain GET requests, for scripts. No authentication; see ${url(withBase('/api/docs/openapi.json'))} for the description.`]
              : []),
          ]
        : []),
      `- [Sitemap](${url(withBase('/sitemap.xml'))}): the same pages as HTML, with last-modified dates.`,
      `- [Recently updated](${url(withBase('/updates.xml'))}): an Atom feed of the pages that changed most recently, newest first.`,
      `- [Documentation home](${url(siteConfig.home)}): the browsable site, with search and navigation.`,
      '',
    ].join('\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
};
