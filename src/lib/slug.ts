/**
 * GitHub's slug algorithm.
 *
 * The one place a human-readable string becomes a fragment identifier, so an
 * anchor written by a component and an anchor computed for the agent manifest
 * cannot disagree about the same heading.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}
