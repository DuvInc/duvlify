/**
 * Which hosts a search engine may index.
 *
 * A Worker with `preview_urls` answers on its production host and on a
 * per-version preview host, and both serve the same build: the same
 * `robots.txt` saying `Allow: /`, the same `index, follow`, a canonical naming
 * production. A preview link pasted somewhere public can then be crawled and
 * indexed beside the real site, splitting its ranking. `SITE_URL` cannot help,
 * because it is a build-time value and both hosts run the same build.
 *
 * `INDEXABLE_HOSTS`, a comma-separated Worker variable, names the hosts that
 * may be indexed. On any other host `robots.txt` disallows everything and every
 * response carries `X-Robots-Tag: noindex, nofollow`. Unset, every host stays
 * indexable, exactly as before, so an existing deployment changes nothing until
 * its owner opts in.
 *
 * No imports, so `test/indexing.test.mjs` runs it without a Worker.
 */

export function isIndexableHost(hostname: string, list: string | undefined): boolean {
  const hosts = (list ?? '')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean);
  return hosts.length === 0 || hosts.includes(hostname.toLowerCase());
}

/** The robots.txt a non-indexable host answers with. */
export const DISALLOW_ALL = 'User-agent: *\nDisallow: /\n';

/**
 * Marks a response as not for indexing, unless it already says so itself (the
 * HTTP API sends its own `noindex`). A protocol switch is left untouched.
 */
export function withNoindex(response: Response): Response {
  if (response.status === 101) return response;
  if (/noindex/i.test(response.headers.get('X-Robots-Tag') ?? '')) return response;
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
