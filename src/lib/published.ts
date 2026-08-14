import { getCollection, type CollectionEntry } from 'astro:content';

/**
 * Publication state, in one place.
 *
 * `draft: true` in a page's frontmatter means the file stays in the repository
 * and out of the site: no HTML route, no Markdown twin, no share card, no
 * sidebar entry, no search result, no sitemap row, no line in llms.txt. It is
 * what an author flips to park a page mid-write without deleting it or moving
 * it out of content/.
 *
 * Every consumer reads the collection through the helpers below instead of
 * repeating the predicate, because "published" has to mean the same thing in
 * all eleven places that ask. The moment one of them spells the filter itself,
 * a draft leaks into exactly one output — and an output nobody looks at, which
 * is how a draft ends up in llms.txt for a year.
 *
 * `noindex` is a different switch, and deliberately so: that page *is*
 * published, routed and linked. It is kept out of every surface that broadcasts
 * a page — search results, the sitemap, the updates feed, the llms.txt corpus —
 * on the reasoning that a page withheld from search should not be handed to a
 * model either. Draft is about existing; noindex is about being found.
 */
export type DocEntry = CollectionEntry<'docs'>;

export const isPublished = (entry: DocEntry) => !entry.data.draft;

/** Every page that ships. The default reading of the collection. */
export const getPublishedDocs = () => getCollection('docs', isPublished);

/**
 * Every page on disk, drafts included.
 *
 * Only navigation resolution needs this, and only to tell "this id names a
 * draft" from "this id is a typo". From the published set the two are
 * indistinguishable, and they deserve opposite treatment: the first is an
 * author's deliberate choice and must pass silently, the second is a mistake
 * that must fail the build.
 */
export const getAllDocs = () => getCollection('docs');

/** Index a set of entries by id, for the joins navigation and the feeds do. */
export const byId = (entries: DocEntry[]) =>
  new Map<string, DocEntry>(entries.map(entry => [entry.id, entry]));
