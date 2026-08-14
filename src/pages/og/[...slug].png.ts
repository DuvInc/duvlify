import type { CollectionEntry } from 'astro:content';
import type { APIRoute } from 'astro';
import { primeCard } from '../../lib/og-card';
import { getFlatPages } from '../../lib/navigation';
import { byId, getPublishedDocs } from '../../lib/published';

/**
 * One share card per page, drawn from the page's own title and section, so a
 * link posted anywhere carries the page it points at rather than a generic
 * logo. Generated at build time; see src/lib/og-card.ts for why these are
 * rasterised to PNG rather than served as SVG.
 */
/** What this page's card is drawn from. One place, so priming and serving agree. */
const cardFor = (entry: CollectionEntry<'docs'>, eyebrow: string) => ({
  title: entry.data.title,
  eyebrow,
  description: entry.data.description,
});

export async function getStaticPaths() {
  const entries = byId(await getPublishedDocs());
  const pages = await getFlatPages();

  const paths = pages.map(({ page, tab, group }) => ({
    params: { slug: page.id },
    props: {
      entry: entries.get(page.id)!,
      eyebrow: group.folder ? `${tab.label} · ${group.label}` : tab.label,
    },
  }));

  /*
   * Every card starts rasterising here, before Astro asks for the first one.
   *
   * Not awaited: this returns the path list immediately and leaves the encoders
   * running in the background, several at a time, so by the time the generator
   * reaches a given card it is usually already done. Awaiting them here would
   * reproduce exactly the sequential wait this avoids, just earlier.
   */
  for (const { params, props } of paths) {
    void primeCard(params.slug, cardFor(props.entry, props.eyebrow));
  }

  return paths;
}

interface Props {
  entry: CollectionEntry<'docs'>;
  eyebrow: string;
}

export const GET: APIRoute = async ({ params, props }) => {
  const { entry, eyebrow } = props as Props;
  return new Response(
    new Uint8Array(await primeCard(params.slug!, cardFor(entry, eyebrow))),
    { headers: { 'Content-Type': 'image/png' } },
  );
};
