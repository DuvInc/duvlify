import type { APIRoute } from 'astro';
import { agents, seo, withBase } from '../docs.config';
import { hasOpenApiSpec, OPENAPI_PATH } from '../lib/openapi-spec';

/**
 * robots.txt, doing two jobs.
 *
 * 1. Let everything crawl everything. Documentation has nothing to hide, and
 *    that now includes the Markdown twins.
 *
 *    It did not always. Every page is served twice — as HTML and, at the same
 *    path plus `.md`, as Markdown — which is the duplicate-content shape search
 *    engines discount, and the fix for it is a canonical link on the duplicate.
 *    Cloudflare's `_headers` patterns allow one trailing splat and so cannot
 *    select `*.md`, so for a while the only available tool was a `Disallow`
 *    aimed at the search crawlers. worker/index.ts now sets
 *    `Link: <page>; rel="canonical"` on every Markdown response, which is the
 *    signal that was missing — so the block is gone and the Markdown is offered
 *    to everyone. A crawler that indexes it credits the HTML page.
 *
 * 2. Say out loud what the content may be used for, via Cloudflare's Content
 *    Signals. Not yet a standard — the IETF's AIPREF work is where that lands —
 *    but it is unambiguous, machine-readable, and costs one line.
 */
export const GET: APIRoute = ({ site }) => {
  const signals = Object.entries(seo.contentSignals)
    .map(([name, value]) => `${name}=${value}`)
    .join(', ');

  const lines = [
    '# Content-Signal declares how this content may be used.',
    '#   search:   build a search index, show links and snippets',
    '#   ai-input: use as grounding for a generated answer',
    '#   ai-train: use to train or fine-tune a model',
    '# Documentation exists to be found and quoted, so all three are yes.',
    '',
    'User-agent: *',
    /* Inside the group, not above it: a directive before any User-agent line
       belongs to no group and is skipped by conforming parsers. */
    `Content-Signal: ${signals}`,
    'Allow: /',
    '',
    '# Named explicitly rather than left to the wildcard above: several of these',
    '# check for their own group first, and some operators read an unlisted agent',
    '# as an oversight. An explicit rule answers either reading.',
    ...seo.aiCrawlers.flatMap(agent => [`User-agent: ${agent}`, 'Allow: /', '']),
    `Sitemap: ${new URL(withBase('/sitemap.xml'), site).href}`,
    '',
    '# Machine-readable copies of this documentation:',
    `#   ${new URL(withBase('/llms.txt'), site).href}       an index of every page`,
    `#   ${new URL(withBase('/llms-full.txt'), site).href}  the full text in one file`,
    `#   ${new URL(withBase('/updates.xml'), site).href}    an Atom feed of what changed most recently`,
    ...(hasOpenApiSpec
      ? [`#   ${new URL(withBase(OPENAPI_PATH), site).href}   the OpenAPI description of the API`]
      : []),
    '#   append .md to any page URL, or send Accept: text/markdown, for that page as Markdown',
    ...(agents.enabled
      ? [
          '',
          '# This documentation is also callable, not just readable:',
          `#   ${new URL(withBase('/mcp'), site).href}        an MCP server — search, fetch, list_pages`,
          ...(agents.http ? [`#   ${new URL(withBase('/api/docs'), site).href}   the same tools over plain HTTP`] : []),
        ]
      : []),
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
