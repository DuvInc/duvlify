import { appendFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The headers of every generated file whose type the extension does not say on
 * its own, in one place.
 *
 * A route's `Response` headers only exist in `astro dev`. The build writes the
 * body to `dist/` and drops the rest, so in production the host picks the
 * headers from the extension: `/openapi.json` went out as `application/json`
 * with no CORS header, which browser tools on another origin cannot fetch, and
 * the Atom feed as plain `application/xml`. A sibling site found it from a curl
 * on its preview.
 *
 * So the routes read their headers here (for `astro dev`), and
 * `writeRouteHeaders` appends the same values to `dist/_headers` at the end of
 * the build (for Cloudflare and Netlify), only for the files the build actually
 * wrote: a site with no spec gets no `/openapi.json` rule. A test fails when a
 * route sets a header of its own instead of reading it from this table.
 *
 * Keys are `_headers` rules: an exact path, or `/*.ext` for every file with
 * that extension. Images are left out: their extension already gives the type.
 */
export const ROUTE_HEADERS = {
  '/openapi.json': {
    /* The type registered for OpenAPI 3.1; agents sniffing for it look here
       before they look at the extension. */
    'Content-Type': 'application/openapi+json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  },
  /* No route ships this one; the recipe in the API reference guide adds it. */
  '/openapi.yaml': {
    'Content-Type': 'application/yaml; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  },
  '/agent-manifest.json': {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  },
  '/llms.txt': { 'Content-Type': 'text/plain; charset=utf-8' },
  '/llms-full.txt': { 'Content-Type': 'text/plain; charset=utf-8' },
  '/robots.txt': { 'Content-Type': 'text/plain; charset=utf-8' },
  '/search-index.json': { 'Content-Type': 'application/json; charset=utf-8' },
  '/sitemap.xml': { 'Content-Type': 'application/xml; charset=utf-8' },
  '/updates.xml': { 'Content-Type': 'application/atom+xml; charset=utf-8' },
  /* The Worker sets this itself; the rule is for a host without it. */
  '/*.md': { 'Content-Type': 'text/markdown; charset=utf-8' },
} as const satisfies Record<string, Record<string, string>>;

export type RouteHeaderRule = keyof typeof ROUTE_HEADERS;

function builtFiles(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const next = path.join(dir, item.name);
    return item.isDirectory() ? builtFiles(next, base) : [`/${path.relative(base, next).split(path.sep).join('/')}`];
  });
}

/** The rules this build needs, as `_headers` text: one per table entry that matches a built file. */
export function routeHeaderRules(files: readonly string[]): string {
  const blocks = Object.entries(ROUTE_HEADERS)
    .filter(([rule]) => {
      const extension = rule.match(/^\/\*(\.[a-z0-9]+)$/i)?.[1];
      return extension ? files.some(file => file.endsWith(extension)) : files.includes(rule);
    })
    .map(([rule, headers]) => [
      rule,
      /* `!` first: the host has already chosen a Content-Type from the
         extension, and a second value would be appended to it, not replace it. */
      ...Object.keys(headers).map(name => `  ! ${name}`),
      ...Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`),
    ].join('\n'));
  return blocks.length
    ? `\n# Generated at build time from src/lib/route-headers.ts. Edit that file, not this block.\n${blocks.join('\n\n')}\n`
    : '';
}

/** Astro integration: appends the rules to the built `_headers`. */
export function routeHeaders() {
  return {
    name: 'route-headers',
    hooks: {
      'astro:build:done': ({ dir }: { dir: URL }) => {
        const out = fileURLToPath(dir);
        const rules = routeHeaderRules(builtFiles(out));
        if (rules) appendFileSync(path.join(out, '_headers'), rules);
      },
    },
  };
}

/** For `astro dev`, where a route's own headers are the ones served. */
export const headersFor = (rule: RouteHeaderRule): Record<string, string> => ({ ...ROUTE_HEADERS[rule] });
