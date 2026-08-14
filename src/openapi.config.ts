/**
 * The OpenAPI document the endpoint pages render from.
 *
 * This one is an EXAMPLE, and it is meant to be deleted. Duvlify documents a
 * framework, not a service, so it has no API of its own. Without a spec the
 * whole API-reference feature would be documented in prose and never shown, so
 * a small fictional API stands in: three operations over a `widget` resource,
 * the placeholder noun, on `api.example.com`. The "Example API" tab says so in
 * its label, and every page in it opens with a callout that repeats it.
 *
 * A fictional API that an agent retrieves and answers from would be worse than no
 * example at all, so `seo.agentInstructions` in docs.config.ts states plainly that
 * these endpoints are not real. That block is emitted at the top of llms.txt,
 * ahead of the corpus, which is the one place a model reads before the pages.
 * `noindex` was the other candidate and is the wrong tool here: it suppresses the
 * JSON-LD graph as well, so the pages would stop demonstrating the `APIReference`
 * typing that `seo.apiReferenceTabs` exists to apply.
 *
 * Replace this object with your own OpenAPI 3.1 document, written inline or
 * imported from a JSON file the build can read. Then rewrite the pages under
 * content/example-api/ to name your own operations, drop that paragraph from
 * `agentInstructions`, and change the tab id in `seo.apiReferenceTabs` if you
 * rename the tab.
 *
 * An empty `paths` is the off switch. src/lib/openapi-spec.ts reads it, and
 * everything that would otherwise advertise a spec — the /openapi.json route,
 * the `service-desc` link in the document head, the Optional section of
 * llms.txt, the API catalog entry — stays silent rather than pointing at a
 * document with no endpoints in it. That distinction matters more for agents
 * than for people: a person who opens an empty spec closes it, while an agent
 * may read it as evidence that the API has no endpoints.
 *
 * Endpoint pages carry only method/path identity in their frontmatter.
 * Parameters, request bodies, response shapes, the response tabs and the
 * generated client snippets are all resolved from this document at build time,
 * so the spec stays the single source of truth and no MDX restates a field name.
 *
 * Write every `description` in Markdown. OpenAPI defines them as CommonMark and
 * src/lib/spec-markdown.ts renders them as such, so a `` `field_name` `` in a
 * schema description becomes a code chip exactly as it would in a page.
 */
export const openapiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Example API',
    version: '2026-08-01',
    description:
      'A fictional API, included only to show what Duvlify renders from an OpenAPI document. It does not exist. See [the introduction](/example-api/introduction).',
  },
  servers: [{ url: 'https://api.example.com/v1', description: 'Production' }],
  security: [{ bearerAuth: [] }],
  tags: [{ name: 'Widgets', description: 'Create, list and read widgets.' }],
  paths: {
    '/widgets': {
      get: {
        operationId: 'listWidgets',
        summary: 'List widgets',
        description:
          'Returns widgets, newest first. Pagination is cursor-based. Pass the `next_cursor` from the previous response without changing it. Offsets are not supported, because a widget created mid-pagination would shift them.',
        tags: ['Widgets'],
        parameters: [
          {
            name: 'status',
            in: 'query',
            required: false,
            description: 'Return only widgets in this state. All states are returned by default.',
            schema: { type: 'string', enum: ['draft', 'active', 'archived'] },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            description: 'Records per page. A request above the maximum is clamped, not rejected.',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
          {
            name: 'cursor',
            in: 'query',
            required: false,
            description: 'The `next_cursor` from a previous response. Returns the page after it.',
            schema: { type: 'string', example: 'w_01HQ8…' },
          },
        ],
        responses: {
          '200': {
            description: 'A page of widgets.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data', 'has_more'],
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/Widget' } },
                    has_more: {
                      type: 'boolean',
                      description: 'Whether another page follows this one.',
                      example: false,
                    },
                    next_cursor: {
                      type: 'string',
                      description: 'Pass this back as `cursor`. Absent on the last page.',
                      example: 'w_01HQ8ZK7',
                    },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        operationId: 'createWidget',
        summary: 'Create a widget',
        description:
          'Creates one widget. Send an `Idempotency-Key` header with a unique value per logical operation, so that a retried request returns the original widget instead of creating a second one.',
        tags: ['Widgets'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: {
                    type: 'string',
                    minLength: 2,
                    maxLength: 80,
                    description: 'Shown wherever the widget is listed.',
                    example: 'Checkout banner',
                  },
                  description: {
                    type: 'string',
                    maxLength: 500,
                    description: 'What the widget is for. Write the removal condition here too.',
                  },
                  status: {
                    type: 'string',
                    enum: ['draft', 'active'],
                    default: 'draft',
                    description: 'A widget starts as a draft unless you set this to `active`.',
                  },
                  tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Free-form labels. Use them to group widgets in a list.',
                    example: ['marketing'],
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'The widget was created.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Widget' } },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '422': { $ref: '#/components/responses/ValidationFailed' },
        },
      },
    },
    '/widgets/{widget_id}': {
      parameters: [{ $ref: '#/components/parameters/WidgetId' }],
      get: {
        operationId: 'getWidget',
        summary: 'Retrieve a widget',
        description: 'Returns one widget by its id.',
        tags: ['Widgets'],
        responses: {
          '200': {
            description: 'The widget.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Widget' } },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'An API key, sent as `Authorization: Bearer sk_example_…`.',
      },
    },
    parameters: {
      WidgetId: {
        name: 'widget_id',
        in: 'path',
        required: true,
        description: 'The widget id, returned when the widget was created.',
        schema: { type: 'string', example: 'wid_01HQ8ZK7' },
      },
    },
    responses: {
      Unauthorized: {
        description: 'The API key is missing, malformed or revoked.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      NotFound: {
        description: 'No widget with this id exists.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      ValidationFailed: {
        description: 'A field failed validation. `error.field` names it.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
    schemas: {
      Widget: {
        type: 'object',
        required: ['id', 'name', 'status', 'created_at'],
        properties: {
          id: { type: 'string', description: 'Unique and immutable.', example: 'wid_01HQ8ZK7' },
          name: { type: 'string', example: 'Checkout banner' },
          description: { type: 'string', example: 'Shown above the payment step.' },
          status: {
            type: 'string',
            enum: ['draft', 'active', 'archived'],
            description: 'A widget is only served to callers while it is `active`.',
            example: 'active',
          },
          tags: { type: 'array', items: { type: 'string' }, example: ['marketing'] },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'RFC 3339, always UTC.',
            example: '2026-08-01T09:24:11Z',
          },
        },
      },
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: {
                type: 'string',
                description: 'Stable identifier. Branch on this, not on `message`.',
                example: 'widget_not_found',
              },
              message: {
                type: 'string',
                description: 'One sentence for a person. The wording can change.',
                example: 'No widget with this id exists.',
              },
              field: {
                type: 'string',
                description: 'The field that failed validation, on a 422 only.',
                example: 'name',
              },
            },
          },
        },
      },
    },
  },
} as const;
