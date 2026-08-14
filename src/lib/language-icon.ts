import { withBase } from '../docs.config';

/**
 * The `--api-language-icon` value for a language slug.
 *
 * One function because four places draw this icon — the API panel, its
 * language selector, and both halves of a code group's dropdown — and the URL
 * has to carry `basePath`. Written by hand, it did not: under a subpath
 * deployment every one of these silently requested the marketing site's root
 * and drew nothing, which reads as "this language has no icon" rather than as
 * a broken path.
 */
export const languageIconUrl = (slug: string) =>
  `url('${withBase(`/icons/languages/${slug}.svg`)}')`;
