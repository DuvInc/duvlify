import { openapiSpec } from '../openapi.config';

/**
 * Whether this distribution actually ships an API description, and where it is
 * published when it does.
 *
 * The engine is shared by distributions that document an API and by ones that
 * do not, and openapi.config.ts carries a valid-but-empty spec in the second
 * case. Everything that would otherwise advertise the spec — the route, the
 * `service-desc` link in the document head, the Optional section of llms.txt —
 * asks here first, so a site with no endpoints never points a reader or an
 * agent at a document with no paths in it.
 *
 * That matters more for agents than for people. A person who opens an empty
 * spec closes it; an agent that fetches one may take it as evidence that the
 * API has no endpoints and answer accordingly.
 */
export const OPENAPI_PATH = '/openapi.json';

export const hasOpenApiSpec = Object.keys((openapiSpec as { paths?: object }).paths ?? {}).length > 0;

export const openApiTitle = (openapiSpec as { info?: { title?: string; version?: string } }).info;

/**
 * The documented API's own base URL, as the specification states it.
 *
 * The API catalog needs it: RFC 9727 anchors each entry on the API itself, not
 * on the page that describes it. Read from `servers[0].url` rather than guessed,
 * and undefined when the spec names no server — in which case the catalog has
 * nothing truthful to anchor on and leaves the API out.
 */
export const openApiServer: string | undefined = (
  openapiSpec as { servers?: readonly { url: string }[] }
).servers?.[0]?.url;
