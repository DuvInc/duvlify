import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * When a page last actually changed, for `dateModified` and the sitemap.
 *
 * Read from the file's last commit rather than its mtime: a fresh `git clone`
 * in CI gives every file the checkout time, which would tell search engines the
 * whole site changed on every deploy — a freshness signal that means nothing is
 * worse than none.
 *
 * A page can override this with `updated:` in its frontmatter, for the case
 * where the commit history overstates a change (a typo fix should not reset a
 * page's age) or understates one (content moved between files).
 *
 * A commit whose message has the line `Page-dates: keep` is skipped. That is
 * for the bulk change that touches many files without changing what they say:
 * removing dead frontmatter keys from 284 migrated pages would otherwise have
 * marked all 284 as updated that day, in the sitemap, the updates feed and
 * every page's `dateModified`. On a squash merge the line must survive into the
 * final message, so check what the repository's squash setting keeps.
 */

export const KEEP_DATES_TRAILER = 'Page-dates: keep';

const cache = new Map<string, Date | null>();

/** Falls back to null — never to "now", which would be a lie. */
export function gitLastModified(contentPath: string): Date | null {
  if (cache.has(contentPath)) return cache.get(contentPath)!;

  let result: Date | null = null;
  const absolute = path.resolve(process.cwd(), contentPath);

  if (existsSync(absolute)) {
    try {
      const iso = execFileSync('git', [
        'log', '-1', '--format=%cI',
        '--invert-grep', `--grep=^${KEEP_DATES_TRAILER}$`,
        '--', absolute,
      ], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (iso) result = new Date(iso);
    } catch {
      /* Not a git checkout, or git is unavailable. Both are fine. */
    }
  }

  cache.set(contentPath, result);
  return result;
}

/** The date to publish for an entry, in precedence order. */
export function lastModifiedFor(entry: {
  id: string;
  filePath?: string;
  data: { updated?: Date; published?: Date };
}): Date | undefined {
  return (
    entry.data.updated ??
    gitLastModified(entry.filePath ?? `content/${entry.id}.mdx`) ??
    entry.data.published ??
    undefined
  );
}
