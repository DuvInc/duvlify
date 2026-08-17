---
title: "Serving agents"
description: "Duvlify defines six agent surfaces and four tools once, then adapts them to MCP, plain HTTP and WebMCP so they always agree."
canonical: "https://duvlify.dev/agents/overview"
updated: "2026-08-18"
---

# Serving agents

People can read this site. Agents can call it. These are different jobs, so
the site serves them through different surfaces.

| Surface                              | Who uses it                                 | What it is                                         |
| ------------------------------------ | ------------------------------------------- | -------------------------------------------------- |
| `llms.txt`, `llms-full.txt`          | crawlers, training pipelines                | a map of the corpus and the corpus itself, as text |
| `<page>.md`, `Accept: text/markdown` | anything that follows a link                | every page as clean Markdown                       |
| `/mcp`                               | Claude, Cursor, ChatGPT, Claude Code        | the docs as callable tools                         |
| `/api/docs/*`                        | scripts, `curl`, anything without MCP       | the same tools as plain GET                        |
| WebMCP                               | agents running inside the visitor's browser | the same tools again, registered on the page       |
| `/agent-manifest.json`               | the Worker, and anyone curious              | the outline of every page with line offsets        |

The first two rows are static. They exist in the build output and cost
nothing to serve. The Worker serves the rest, and `agents.enabled` in
[`src/docs.config.ts`](https://github.com/DuvInc/duvlify/blob/main/src/docs.config.ts)
turns them all on together.

## The four tools

[`worker/agent/tools.ts`](https://github.com/DuvInc/duvlify/blob/main/worker/agent/tools.ts) defines each tool once, as a
name, a description, a JSON Schema and a handler. MCP, HTTP and WebMCP are
three adapters over that one array. This is why they always agree on what
`search` means. Adding a new tool takes one entry.

### `search(query, limit?)`

Returns passages grouped by the page they came from.

```jsonc
{
  "query": "custom domain",
  "pages": [
    {
      "url": "https://docs.example.com/guides/deployment",
      "title": "Deploy your site",
      "description": "…",
      "type": "page",
      "tab": "Guides",
      "updated": "2026-08-03",
      "totalLines": 176,
      "chunks": [
        { "lines": [52, 74], "heading": "Host configuration",              "text": "…" },
        { "lines": [75, 97], "heading": "Host configuration › Caching",    "text": "…" }
      ]
    }
  ]
}
```

The response uses two different orderings, and both are intentional:

- **Pages follow relevance.** The first passage of a page not yet seen creates
  that page at the next position. The order of `pages` is the ranking.
- **Chunks follow the page.** An agent reading three passages from one page
  wants them in reading order. Sorting by relevance would scramble a
  procedure whose steps only make sense in sequence.

**No score appears in the response, at either level.** Neither retrieval
backend produces a number an agent could interpret. A reciprocal-rank-fusion
score is a sum of inverted ranks, not a similarity score. An uninterpretable
number would only invite false confidence. Dropping it also lets the
retriever use `rrf`, which ranks better than the alternative that would have
produced a displayable figure.

`lines` and `totalLines` let an agent decide whether to call `fetch`. Three
passages spanning lines 40 to 95 of a 260-line page cover a third of a
scattered topic, so loading the whole page is worth it. One passage at lines
12 to 20 is not.

### `fetch(url)`

This tool returns the complete Markdown of one page. The Markdown is
byte-identical to what `<page>.md` serves and to what the index stores. It
takes the `url` from `search` or `list_pages`. A bare path also works, so an
agent that shortened a link still lands on the page.

Pages are identified by URL and nothing else. An internal id does exist. It
is the join key between AI Search's `item.key` and the build manifest, but it
never appears in a response.

### `list_pages(tab?, type?, prefix?, updated_since?)`

This tool lists the corpus without going through search. It shows what
pages exist, what kind of page each one is, and when it last changed. An
agent that calls an MCP server does not read `llms.txt`, so this tool is
where that information has to live for the agent to see it. It reads
entirely from the manifest, so it makes no retrieval call and costs nothing.

### `report_issue(page, …)` (optional)

This tool stays hidden from `tools/list` until a webhook is set. That
destination is a Worker secret, `FEEDBACK_WEBHOOK`, not a value in
`docs.config.ts`. See [Secrets](/reference/configuration#secrets) for why. The
`fields` and `context` shown below still live in the config, because they are
not deployment-specific: one declaration defines both the fields the agent must
supply and the payload the webhook receives, so the two cannot drift apart.

```ts
feedback: {
  fields: [
    { name: 'problem', type: 'string', required: true, maxLength: 2000, description: '…' },
    { name: 'kind', type: 'enum', required: false, values: ['inaccurate', 'outdated', 'missing', 'unclear'] },
  ],
  context: ['page', 'pageId', 'agent', 'siteVersion', 'reportedAt'],
}
```

```bash
wrangler secret put FEEDBACK_WEBHOOK
```

`fields` is what the agent supplies. `context` is what the Worker adds, and
the agent can neither supply it nor forge it. If delivery fails, the tool
reports the failure back to the agent as a message instead of throwing an
error. A feedback tool must never break the conversation that called it.

**Continue with agents**

What sits behind `` `search`, `` and how an agent finds any of this without being told the URLs.

[Retrieval](/agents/retrieval)

[Discoverability](/agents/discovery)
