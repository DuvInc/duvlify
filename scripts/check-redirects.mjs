import { existsSync, statSync } from 'node:fs';

/**
 * A permanent redirect to a typo is cached by browsers. Validate against the
 * actual build, which also excludes draft pages and respects homePageId.
 * @param {Readonly<Record<string, string>>} moves
 * @param {URL} directory
 */
export function assertRedirectTargets(moves, directory) {
  for (const [from, target] of Object.entries(moves)) {
    const candidates = target === '/'
      ? ['index.html']
      : [`.${target}/index.html`, `.${target}.html`];
    if (!candidates.some(candidate => {
      const file = new URL(candidate, directory);
      return existsSync(file) && statSync(file).isFile();
    })) {
      throw new Error(`Redirect "${from}" points to missing page "${target}". Choose a page published in this build.`);
    }
  }
}
