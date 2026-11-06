import { existsSync, statSync } from 'node:fs';

/**
 * A permanent redirect to a typo is cached by browsers. Validate against the
 * actual build, which also excludes draft pages and respects homePageId.
 *
 * The source must not be a published page either. One of the two is dead: the
 * Worker answers the redirect, and the page stays listed in the sitemap, the
 * agent manifest, llms.txt and the search index, so agents follow a URL that
 * answers 301 (found on a 330-page site, 2026-11-06). Delete the page, or the
 * redirect.
 * @param {Readonly<Record<string, string>>} moves
 * @param {URL} directory
 */
export function assertRedirectTargets(moves, directory) {
  const built = path => (path === '/' ? ['index.html'] : [`.${path}/index.html`, `.${path}.html`])
    .some(candidate => {
      const file = new URL(candidate, directory);
      return existsSync(file) && statSync(file).isFile();
    });
  for (const [from, target] of Object.entries(moves)) {
    if (!built(target)) {
      throw new Error(`Redirect "${from}" points to missing page "${target}". Choose a page published in this build.`);
    }
    if (built(from)) {
      throw new Error(`Redirect "${from}" is also a published page. Delete the page or the redirect: the page is listed everywhere and never reached.`);
    }
  }
}
