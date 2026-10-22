/**
 * The URL of a page's Markdown twin.
 *
 * Most pages use their URL plus `.md`. The homepage uses `index.md`, including
 * under a deployment prefix: `/docs` and `/docs/` both name `/docs/index.md`.
 * Page actions, metadata, feeds and the Worker all use this resolver.
 *
 * Takes either an absolute URL or a root-relative path, and preserves which.
 */
import { basePath } from '../docs.config.ts';

export function markdownUrl(base: string, homePath: string = basePath): string {
  const url = new URL(base, 'https://markdown.invalid');
  const pathname = url.pathname.replace(/\/$/, '');
  const home = homePath.replace(/\/$/, '');
  url.pathname = pathname === home ? `${home}/index.md` : `${pathname}.md`;
  return /^https?:\/\//.test(base) ? url.href : `${url.pathname}${url.search}${url.hash}`;
}

/** A directory-backed page can store its twin as either spelling. */
export function markdownPathsFor(path: string): string[] {
  const direct = markdownUrl(path, '');
  const index = `${path.replace(/\/$/, '')}/index.md`;
  return direct === index ? [direct] : [direct, index];
}
