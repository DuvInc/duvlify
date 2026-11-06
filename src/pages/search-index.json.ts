import type { APIRoute } from 'astro';
import { getSearchIndex } from '../lib/navigation';
import { headersFor } from '../lib/route-headers';

/**
 * The full-text search index, as one static file built once.
 *
 * src/scripts/search.ts fetches it the first time a reader opens search, so no
 * page carries index markup and page weight stays flat as the docs grow.
 */
export const GET: APIRoute = async () =>
  new Response(JSON.stringify(await getSearchIndex()), {
    headers: headersFor('/search-index.json'),
  });
