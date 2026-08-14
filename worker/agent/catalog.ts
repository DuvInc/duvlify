import { site } from '../../src/docs.config';
import { hasOpenApiSpec, openApiServer, OPENAPI_PATH } from '../../src/lib/openapi-spec';
import { API_PREFIX } from './http';

/**
 * The API catalog, at `/.well-known/api-catalog` (RFC 9727).
 *
 * One document that says which APIs this origin has and, for each, where its
 * description, its human documentation and its liveness check live. Without it an
 * agent has to read the documentation to find the API that the documentation
 * describes — which is the wrong way round, and the reason the well-known URI
 * exists.
 *
 * A site that documents a product has two APIs, and the catalog is the first
 * place that states the difference plainly:
 *
 *   - the *documented* API, whose base URL comes from the specification's own
 *     `servers[0].url`, described by the copy of the spec this site publishes;
 *   - this documentation's own read-only API under /api/docs, which serves the
 *     same tools as the MCP server and touches no product data.
 *
 * Each is listed only when it exists: no configured spec, no first entry; agents
 * turned off or the HTTP surface disabled, no second one. An empty catalog is
 * still valid and still useful — it says "this origin has no APIs" rather than
 * leaving a client to guess from a 404.
 */

/** RFC 9264 §4.2: a link target object. `href` required, the rest optional. */
interface LinkTarget {
  href: string;
  type?: string;
  title?: string;
}

/**
 * RFC 9264 §4.2: a link context object. `anchor` is the context URI, and every
 * other member is a link relation type whose value is an *array* of targets —
 * an array even for one link, which is what makes the format uniform.
 */
interface LinkContext {
  anchor: string;
  'service-desc'?: LinkTarget[];
  'service-doc'?: LinkTarget[];
  status?: LinkTarget[];
}

export const API_CATALOG_PATH = '/.well-known/api-catalog';

/**
 * RFC 9727 §3 names this as the catalog's media type. It is not
 * `application/json`: a client that content-negotiates for a linkset will not
 * accept the generic type, and the specific one is what says this document
 * follows RFC 9264's structure rather than being some JSON that happens to
 * contain links.
 */
const LINKSET_TYPE = 'application/linkset+json';

const OPENAPI_TYPE = 'application/openapi+json';

/**
 * Builds the catalog for one origin.
 *
 * `base` is the origin plus `site.basePath` — where this documentation actually
 * lives — because every link the catalog publishes is one a client will fetch.
 */
export function apiCatalog(base: string, options: { http: boolean }): { linkset: LinkContext[] } {
  const linkset: LinkContext[] = [];

  /*
   * The documented API. Anchored on the API's own base URL, so an agent that
   * already holds a request URL can match it against this entry; `service-desc`
   * then points at the copy of the description this site serves, which is the
   * one guaranteed to be reachable.
   */
  if (hasOpenApiSpec && openApiServer) {
    linkset.push({
      anchor: openApiServer,
      'service-desc': [{ href: `${base}${OPENAPI_PATH}`, type: OPENAPI_TYPE }],
      'service-doc': [{ href: `${base}/`, type: 'text/html', title: `${site.name} documentation` }],
    });
  }

  /*
   * This documentation's own API. `status` is its index: a GET returns the tool
   * list, so a 200 there is exactly the "is it up" signal RFC 9727 asks for,
   * with no endpoint invented for the purpose.
   */
  if (options.http) {
    linkset.push({
      anchor: `${base}${API_PREFIX}`,
      'service-desc': [{ href: `${base}${API_PREFIX}/openapi.json`, type: OPENAPI_TYPE }],
      'service-doc': [{ href: `${base}/`, type: 'text/html', title: `${site.name} documentation` }],
      status: [{ href: `${base}${API_PREFIX}`, type: 'application/json' }],
    });
  }

  return { linkset };
}

export const handleApiCatalog = (base: string, options: { http: boolean }) =>
  new Response(JSON.stringify(apiCatalog(base, options), null, 2), {
    headers: {
      'Content-Type': `${LINKSET_TYPE}; charset=utf-8`,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
