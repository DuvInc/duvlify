---
title: "The manifest, WebMCP and limits"
description: "The page outline agents read for line offsets, the in-browser WebMCP bridge and when to run it yourself, the rate limits, and how the surfaces are tested."
canonical: "https://duvlify.dev/agents/mcp"
updated: "2026-08-28"
---

# The manifest, WebMCP and limits

## The manifest

[`src/lib/agent-manifest.ts`](https://github.com/DuvInc/duvlify/blob/main/src/lib/agent-manifest.ts) emits
`dist/agent-manifest.json` at build time. For each page it records the
page's identity and length. For each heading it records the full path (for
example, `"Custom domains › DNS records"`), the anchor, and the start and
end lines.

One rule makes the whole thing work: **line numbers are counted against the
exact bytes the site serves**. The same `pageMarkdown()` output is what
`<page>.md` returns, what `fetch` returns, and what the indexer uploads. If
these ever diverge, every line range silently starts pointing at the wrong
paragraph.

This is also how a passage gets a heading. AI Search returns chunk text but
not its position. So the Worker finds the text back inside the page and maps
the resulting line to the heading whose range contains it. It does this at
chunk granularity, which no per-page metadata field could ever express.

## WebMCP

There are two ways to register these tools with an in-browser agent, and
duvlify.dev runs the first.

Set `agents.webmcpBridge` to `'on'` and this repository registers them
itself, from
[`src/components/WebMcpBridge.astro`](https://github.com/DuvInc/duvlify/blob/main/src/components/WebMcpBridge.astro).
This is the default here, and it is the **only** option for a deployment
under a subpath or on a domain that is not a Cloudflare zone.

The alternative is Cloudflare's hosted bridge, which costs nothing to
maintain. In the dashboard, go to **Agent Readiness → Labs → Enable
WebMCP**, then under _Tool packs_ check **Site MCP server** only.

The interface says "Leave every pack unchecked to use the default set". The
default set is actually _all_ packs, including a C2PA image-provenance
scanner. That scanner is pure noise on a documentation site, and it costs
context in every agent that loads the page. Check the one pack explicitly
instead.

That pack proxies **this site's own** `/mcp`. Cloudflare does not supply a
generic documentation MCP. It finds this site's server at `<origin>/mcp`,
which is why the MCP endpoint lives on the site's Worker rather than on one
of Cloudflare's own.

It finds that server by convention, not configuration: the pack requests
`tools/list` from `<origin>/mcp` and relays whatever comes back, so nothing
about your tools is ever declared to Cloudflare.

That origin is hard-coded, which is the catch. A site served from `/docs`
has its MCP server at `<origin>/docs/mcp`, where the pack never looks, so it
registers no tools of yours at all. Subpath deployments must use the
repository's own bridge. See [Deploying](/guides/deployment).

Where there is no zone, such as a `workers.dev` deployment or a fork without
a Cloudflare domain, that dashboard screen does not exist either.

Never run both methods together, or the tools would be registered twice.

The browser API was renamed from `navigator.modelContext` to
`document.modelContext` between Chrome 149 and 150. The bridge reads both
names.

### The bridge is two files, and that split is deliberate

The relay logic, which loads the descriptors, sends a call by POST, and reads
the reply, lives in
[`src/lib/webmcp.ts`](https://github.com/DuvInc/duvlify/blob/main/src/lib/webmcp.ts). Only the part that genuinely needs a
browser stays in the component: reading `modelContext` and calling
`registerTool`.

The reason for this split is that the component's contents could not be
verified by a test. The bridge runs only inside a browser that ships the
WebMCP API, and no test here has one. So it broke the day `/mcp` moved to
the official MCP SDK, and nothing noticed. Two defects caused this, both
from assuming the transport was ordinary JSON-RPC over POST:

1. Streamable HTTP requires a client to accept **both** `application/json`
   and `text/event-stream`. The SDK enforces this with a **406** response.
   The bridge sent no `Accept` header, so every tool call was refused.
2. Once that header is sent, the SDK replies in **SSE**. `response.json()`
   throws an error on an SSE reply. Fixing only the first defect would have
   moved the failure, not removed it.

Both facts were already written down at the top of `test/agents.test.mjs`.
The test suite knew about them; the bridge did not, because the suite built
its own request instead of using the shipped one. This is the lesson worth
keeping: a test that reimplements the thing it is testing stays green
through the bug.

A third defect outlived both, and it is the reason the two endpoints take a
prefix argument rather than being written bare. `/mcp/tools` and `/mcp` were
absolute paths. At the empty `basePath` this repository ships they are
correct, so duvlify.dev worked — but under a subpath deployment they resolve
against the origin root, where nothing answers, and any subpath deployment
of this engine would have registered no tools at all.

Nothing would have said so, either: `loadTools` returns an empty list when
the route is unreachable, and the component swallowed the rest in a bare
`catch`, so a broken bridge and a browser without an agent looked identical.
It now warns, and the component passes `site.basePath` to both calls.

This one could not be spelled `withBase(…)` like every other framework-level
path. `src/lib/webmcp.ts` imports nothing on purpose — that is what lets a
test load it under Node's type stripping — so the base has to arrive as an
argument, and `test/publication.test.mjs` asserts the component supplies it.

The handful of lines left in the component are still uncovered by tests.
There is no `modelContext` object in Node, and stubbing one would only prove
that the stub was called.

## Rate limiting

There are three bindings, one per tool family, because the tools do not cost
the same to run. `wrangler.jsonc` configures them, and `agents.rateLimit`
tunes them.

Know what this protection actually does before you trust it. The Workers
rate limiting binding accepts a window of **10 or 60 seconds and nothing
else**, so it cannot express an hourly cap. Its counters are also **per
Cloudflare datacenter**, not global, so a distributed client sees a multiple
of the configured number. Cloudflare documents this behavior as permissive
and eventually consistent by design.

This binding only dampens abuse. It is the protection that works before a
domain exists, which is exactly when nobody is watching.

The real ceiling belongs in a **WAF rate limiting rule** on the zone. A WAF
rule counts over long windows, counts globally, and blocks a request before
the Worker starts, so a flood costs nothing. Configure one on `/api/docs/*`
and `/mcp` once the domain is on Cloudflare, plus a stricter one on
`report_issue`. This rule belongs to operating the domain, not to this
repository, which is why it is documented here rather than committed as
code.

## Testing

[`test/agents.test.mjs`](https://github.com/DuvInc/duvlify/blob/main/test/agents.test.mjs) boots a real Worker and talks
to it over HTTP, rather than importing the handlers directly. The parts most
likely to break are not the pure functions. They are the ASSETS binding, the
manifest fetch, and the routing that has to keep `/mcp` away from the
Markdown content negotiation. A unit test of the grouping logic would pass
even while the endpoint returned a 404.

Among other things, the suite asserts that MCP and HTTP return
byte-identical responses for the same call, that the generated OpenAPI
description matches the live tool set exactly, that no score leaks into a
response, and that every reported line range really contains the passage it
claims.

The WebMCP suite imports `src/lib/webmcp.ts` and points it at the running
Worker. This means it exercises the code the browser actually runs, rather
than a copy of it; see the bridge section above for why that distinction is
the whole point. It checks that the descriptors are shaped the way
`registerTool` demands, that a relayed call comes back as parseable text,
that every advertised tool is reachable, that a failure arrives as a
readable message instead of a thrown exception, and that the suite reads
the reply correctly whether it arrives as JSON or as SSE.

To confirm that a test actually protects something, break the thing on
purpose and watch the test fail. Removing the `Accept` header from
`callTool` turns two of these tests red. Repeat that check whenever the
transport changes.
