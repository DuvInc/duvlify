---
title: "API reference pages"
description: "Point the build at an OpenAPI document, and endpoint pages render their parameters, schemas, response tabs, and request samples from it."
canonical: "https://duvlify.dev/guides/api-reference"
updated: "2026-08-18"
---

# API reference pages

An endpoint page carries only the identity of one operation. The build
resolves everything it renders from your OpenAPI document at build time:
parameters, request bodies, response shapes, the response tabs, and the
generated client snippets. The spec stays the single source of truth, and no
MDX restates a field name.

> **Tip: See it working first**
>
> The [Example API](/example-api/introduction) tab is a live worked example: a
> fictional API, three endpoint pages, and the spec that drives them. Duvlify has
> no API of its own, so that example is what shows the layout. Read it alongside
> this page, then replace both with your own.

## Point the build at a spec

[`src/openapi.config.ts`](https://github.com/DuvInc/duvlify/blob/main/src/openapi.config.ts)
exports one object: an OpenAPI 3.1 document. Write it inline, or import it from
a JSON file the build can read.

```ts title="src/openapi.config.ts"
export const openapiSpec = {
  openapi: '3.1.0',
  info: { title: 'Example API', version: '2026-08-01', description: '…' },
  servers: [{ url: 'https://api.example.com/v1', description: 'Production' }],
  security: [{ bearerAuth: [] }],
  tags: [{ name: 'Flags', description: 'Flag definitions and their variations.' }],
  paths: {
    '/flags': {
      get: {
        operationId: 'listFlags',
        summary: 'List flags',
        tags: ['Flags'],
        parameters: [/* … */],
        responses: {/* … */},
      },
    },
  },
} as const;
```

An empty `paths` value is the off switch. With no operations, the build does
not emit the `/openapi.json` route. It leaves the `service-desc` link out of
the document head. The Optional section of `llms.txt` says nothing about a
spec, and the API catalog leaves the API out.

The last point is the reason this matters. A person who opens an empty spec
closes it and moves on. An agent may instead read the empty spec as evidence
that your API has no endpoints, and answer a question about your product
accordingly.

## Write the endpoint page

```yaml title="content/api/flags/list.mdx"
---
title: List flags
description: Returns flags in the given environment, newest first, with cursors that stay valid as flags are created.
pageType: api-endpoint
apiMethod: GET
apiPath: /flags
apiOperationId: listFlags
apiTag: Flags
---
```

`apiMethod` and `apiPath` must match an operation in the configured spec.
`apiOperationId` and `apiTag` are optional overrides. The body of the page is
ordinary MDX. Use it for the things a spec cannot express: why an endpoint
exists, when to use it over another, and what a caller usually gets wrong.

1. **Add the operation to the spec**

   Add parameters, request body, responses, and schemas. This is where field
   names live, and the only place they live.
2. **Create the page with the frontmatter above**

   Method and path are the join key. A mismatch fails the build instead of
   rendering an empty reference.
3. **List the page in a navigation group**

   Exactly like any other page. See [Authoring](/guides/authoring).
4. **Name the tab in seo.apiReferenceTabs**

   ```ts title="src/docs.config.ts"
   apiReferenceTabs: ['api'],
   ```

   The build then types those pages as schema.org `APIReference` rather than
   `TechArticle`. This is named explicitly rather than inferred from the
   contents, because a showcase that _illustrates_ an endpoint is not an API
   reference. Structured data that overstates what a page is earns a manual
   action rather than a rich result.

## The layout you get

An endpoint page uses a wider three-track frame: navigation, prose, and a
sticky right rail that holds the request and response examples. Below 1280px
the rail column is hidden, and those components return to the article.

A prose page can opt into the same shape with `rightRail: custom` in
frontmatter. Both layouts put prose in the middle with examples alongside, so
they share one set of widths instead of each keeping its own. See
[Page layouts](/reference/page-layouts) for the two settings and what moves.

## Write spec descriptions in Markdown

OpenAPI defines `description` as CommonMark, and the build renders it as such.
A `` `field_name` `` in a schema description becomes a code chip, exactly as it
would in a page.

```ts
{
  name: 'starting_after',
  in: 'query',
  description: 'A flag key. Returns the page immediately after it. See `limit` for page size.',
  schema: { type: 'string', example: 'checkout-v2' },
}
```

This is the one place where prose reaches a page without going through MDX.
[`src/lib/spec-markdown.ts`](https://github.com/DuvInc/duvlify/blob/main/src/lib/spec-markdown.ts)
runs those strings through Astro's own Markdown processor. A spec fetched from
elsewhere at build time would need sanitising there first.

## The spec is published too

When you configure a spec, the build serves it whole at `/openapi.json`, with
the `application/openapi+json` media type that agents look for.

The endpoint pages render the spec as prose, tables, and code samples. That
shape suits a person but not a tool writing code against the API. Such a tool
needs the exact parameter names, the enum members, and the response schema,
not a description of them. Publishing the source document costs one route and
removes the entire class of "the docs said the field was optional" mistakes.

## Writing parameter fields by hand

Write the fields yourself for an API this framework does not drive, or for a
configuration object rather than an endpoint.

**`webhook`** (`string`)

Where `report_issue` delivers. Hidden from the tool list until it is set.

**`rateLimit`** (`object`, required)

Requests per minute per IP, per tool family.

**properties**

**`search`** (`integer`, 30)

Retrieval calls. These are the expensive ones.

**`read`** (`integer`, 90)

`fetch` and `list_pages`. These serve assets.

See [Components](/reference/components#parameter-fields) for the full set.

**Ship the reference**

Endpoint pages, the spec you generated them from, and the Markdown twin of each one all deploy together, on Cloudflare, or on any static host.

[Deploy it](/guides/deployment)
