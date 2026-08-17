---
title: "Retrieval"
description: "Two retrieval backends: a lexical index built at compile time that needs no account, and Cloudflare AI Search for hybrid semantic search when you want it."
canonical: "https://duvlify.dev/agents/retrieval"
updated: "2026-08-18"
---

# Retrieval

Search has two backends. One setting, `agents.retrieval` in
`src/docs.config.ts`, chooses between them. The first backend needs nothing.
The second needs an account, and it adds semantic matching.

### `lexical`: the default, and the floor

This backend scores the build's own search index inside the Worker. It needs
no account setup, no provisioning, and no external call, so it works on the
first deploy. It weights term frequency towards titles and headings. Two
corrections matter more than the weights themselves. First, the score damps
occurrence counts by section length, so a long API reference cannot outscore
a short, on-topic paragraph. Second, it measures coverage across the whole
page, because a question's terms are usually spread between a page's title
and its body.

The backend also does light suffix stripping. Without it, "deployment" fails
to match a page titled "Deploy your site", and the query lands on whichever
page repeats the exact word most.

This backend works well for a few hundred pages, which covers most
documentation sites.

### Two quality filters

Whichever backend runs, `worker/agent/retrieval.ts` filters the results
before grouping them into pages. Two constants control the filter. Both were
calibrated by measurement, and both are specific to this corpus:

| Constant                | Value | What it cuts                                                                      |
| ----------------------- | ----- | --------------------------------------------------------------------------------- |
| `MIN_VECTOR_SIMILARITY` | 0.54  | vector-only hits whose cosine similarity says the passage is about something else |
| `MIN_KEYWORD_SCORE`     | 12    | keyword hits that matched on one incidental common word rather than a real term   |

The retrieval logic keeps a passage if it clears **either** bar. This matters,
because an exact identifier, such as a header name, a CNAME record, or an
error code, often scores zero on vectors. A paraphrased question, in turn,
often has no keyword match at all.

Neither number transfers to another corpus. BM25 depends on term rarity and
query length. The vector bands depend on the embedding model. The reasoning
and the measured distributions are recorded beside each constant. Re-measure
before you change them.

Note that `match_threshold` is pinned low (0.001) in the AI Search request on
purpose. It is _not_ the tuning knob. Under reciprocal rank fusion its scale
is meaningless, and the instance default of 0.4 would filter out every
result. The real tuning lives in the two constants above.

### `ai-search`: semantic, opt-in

Cloudflare AI Search combines vector and keyword retrieval over the corpus.
The build pushes the corpus to it. This backend performs better on
paraphrased questions. To set it up:

1. Create an API token with **AI Search:Edit** and **AI Search:Run** under
   AI → AI Search → Tokens in the Cloudflare dashboard. This token differs
   from the one `wrangler` holds. `wrangler ai-search` refuses to run
   without it.

2. Create the instance:

   ```bash
   npx wrangler ai-search create <name> \
     --type builtin --chunk-size 450 --chunk-overlap 15 --hybrid-search \
     --custom-metadata type:text --custom-metadata updated:datetime \
     --custom-metadata tab:text --custom-metadata locale:text \
     --custom-metadata version:text
   ```

   The dashboard wizard offers the same settings through a slider instead of
   a free-typed number. The slider only lands on fixed increments. The
   production instance runs at **480**, the closest step to the 450 target,
   with 15% overlap and Hybrid search (Reciprocal Rank Fusion, Porter
   stemming) turned on. Either path produces a working instance. The CLI is
   exact, but at this chunk size the dashboard is close enough to make no
   practical difference.

3. Add the binding to `wrangler.jsonc`:

   ```jsonc
   "ai_search": [
     { "binding": "AI_SEARCH", "instance_name": "<name>", "remote": true }
   ]
   ```

   `compatibility_flags: ["nodejs_compat"]` must also be present, because the
   MCP SDK uses `node:async_hooks`. Without this flag, the Worker fails **at
   upload time** with `No such module "node:async_hooks"`. This error is
   clear, but it does not say what asked for the module. The flag ships
   enabled in both repositories.

   `ai_search` (singular) binds directly to one pre-existing instance, which
   is what a Worker actually needs. `ai_search_namespaces` is a different
   binding, for creating and managing instances dynamically at runtime, and
   nothing here does that. `remote: true` matters for local development.
   There is no local emulator for AI Search, so without this setting
   `wrangler dev` would bind to nothing, and every search would silently
   fall back to `lexical`.

4. Set `agents.retrieval` to `'ai-search'` and `agents.aiSearchInstance` to the
   name in `src/docs.config.ts`.

5. Push the corpus after each build: `npm run index:sync`, with
   `CLOUDFLARE_ACCOUNT_ID` and `AI_SEARCH_TOKEN` in the environment.
   `npm run index:dry` shows what would be sent without sending it.

If the binding is missing at runtime, the Worker falls back to `lexical`
instead of failing. A half-finished setup should return slightly worse
answers, not a 500 error.

### The index is reconciled, not just filled

Uploading is an upsert, so on its own the sync script only ever grows the
index. A page that is unpublished, renamed, or marked `noindex` keeps its old
chunks in the index. Search then keeps retrieving content the site itself no
longer serves. This is how three `noindex` compliance pages stayed queryable
after they left the manifest.

To fix this, the script now finishes by listing every indexed item and
deleting whatever the manifest no longer claims. The join is by key: the API
stores `<page id>.md` against the manifest's bare id. The manifest is the
whole published corpus, so anything outside it is stale by definition.

Two guards protect against failure:

- If more than a third of the index looks stale, the script deletes nothing
  and the run reports this. Otherwise, a truncated or half-built manifest
  could empty the index, and removing a third of a corpus is never a routine
  edit.
- A failure to _list_ is reported but does not fail the run. The upload half
  already succeeded, and blocking a good deploy over a cleanup problem would
  trade a small amount of staleness for a stopped release.

`npm run index:dry` prints the deletions as `would delete …` alongside the
uploads. This is a cheap way to check a large content change before it runs.

### When a page fails to upload

The uploader retries five times with exponential backoff. It also paces
itself between pages, because several hundred back-to-back connections would
otherwise draw a steady trickle of resets. A run that still fails is usually
a `503` stretch on Cloudflare's side rather than a bad payload. The total
backoff is about eight seconds, which is not enough to ride out a longer
outage.

The failed page keeps its previous content in the index, since nothing was
overwritten. The index is stale for that one page, not broken. Re-running
the whole script fixes this. The script is idempotent, and the API stores a
checksum per item, so re-running unchanged pages does not count as a content
change.

### Settings that are not obvious from the dashboard

The instance wizard offers several fields with a "smart default". Some of
these defaults are wrong for this use case. Others only matter for a feature
this Worker never uses. Here is what to pick instead, and why:

| Setting             | Smart default               | Use instead                                                     | Why                                                                                                                                                                                                                                         |
| ------------------- | --------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chunk size          | 1024 tokens                 | \~480 (targeted 450; the slider snaps to steps, not free-typed) | At 1024 tokens, an answer and three unrelated paragraphs can end up in one chunk. \~450 keeps a chunk to roughly one section.                                                                                                               |
| Chunk overlap       | 10%                         | 15%                                                             | This stops a hinge sentence from landing exactly on a chunk boundary and being lost from both sides.                                                                                                                                        |
| Hybrid search       | Off                         | **On**                                                          | Vector-only search misses exact identifiers (`WORKER_LIMIT_EXCEEDED`, `apiPath`) that a keyword pass catches easily. This is the default most worth changing.                                                                               |
| Fusion method       | (appears once hybrid is on) | Reciprocal Rank Fusion                                          | This combines results by rank rather than by raw score, so it avoids comparing two incompatible scales. It also means no per-chunk score is meaningful to publish; see below.                                                               |
| Reranking           | Off                         | Leave off                                                       | A cross-encoder pass whose only payoff is a displayable relevance number. This project never shows one, so the extra latency adds no value.                                                                                                 |
| Query rewriting     | Off                         | Leave off                                                       | This is the only step that calls a billed LLM. Nothing here needs the query rephrased.                                                                                                                                                      |
| **Score threshold** | **0.4**                     | **Do not trust this value; see the warning below**              |                                                                                                                                                                                                                                             |
| Similarity cache    | On, Strong, 48h             | On, Strong, **shorter TTL while content changes often**         | A cached answer survives a content fix for the length of the TTL. 48h works fine for a stable site. While you iterate on the docs, use a much shorter TTL (this deployment uses 30 minutes) to avoid serving a pre-fix answer for two days. |
| Generation model    | Smart default (auto)        | Leave it                                                        | AI Search's own answer-generation endpoint uses this setting, and this Worker never calls that endpoint. The Worker only calls retrieval and lets the caller's own model write the answer. The setting stays inert either way.              |
| Boost by            | none                        | Leave empty                                                     | Boosting by recency would rank a marginal page edited yesterday above a canonical page that has been stable for six months. `updated` is used as an explicit filter instead; see the metadata table above.                                  |

> **The 0.4 score threshold can silently return zero results, and the Worker
> does not trust it.** With Reciprocal Rank Fusion, a chunk's score is a sum
> of reciprocal ranks. With the standard formula, even a rank-1 hit on both
> signals tops out around 0.03, nothing like the 0.3 to 0.5 range that a
> cosine-similarity threshold would suggest. A 0.4 floor under `rrf` filters
> out every result, so the query comes back empty with no error to explain
> why.
>
> `worker/agent/retrieval.ts` sets `match_threshold: 0.001` explicitly on
> every request, instead of depending on the instance default, so this case
> is already handled. Still, lower the dashboard's own default too if you
> query the instance any other way, such as through the CLI, a script, or
> the dashboard's own test panel.

**Why the build pushes instead of letting Cloudflare crawl the site.**
Crawling would send a round trip through HTML the build already generated,
and it would lose everything the crawler cannot see: the page type, its
navigation tab, its real git date, its locale. Those are exactly the five
things worth filtering on.

**Why only five metadata fields.** AI Search limits each instance to five
fields, and they attach to the uploaded _item_, the whole page, not to its
chunks. So they are reserved for filtering and ranking (`type`, `updated`,
`tab`, `locale`, `version`), while everything descriptive comes from the
manifest instead. Adding a field later forces a full reindex, which is why the
budget was written down before it was spent.

`version` is the digest of everything an upload puts in the index, **the
Markdown and the metadata**. It is what lets a sync know what changed. The
index carries its own record of what it holds, a property no local manifest file
has, because a local file drifts the moment a second machine deploys. With it, a
run uploads the pages that moved instead of all of them: 22 pages became 0
requests and under a second on a build where nothing changed. On a 198-page site
the upload had been 76 % of the entire build.

The metadata has to be in the digest, and the reason is not obvious. `tab`,
`type` and `locale` are resolved from the manifest rather than read from the
file, so moving a page to a different navigation tab changes **not one byte on
disk**. A digest of the file alone would skip that page forever, and the index
would keep filtering it under a tab the site no longer puts it in. Verified by
moving a page between tabs: identical MD5, re-uploaded correctly.

Every uncertainty resolves toward uploading. An item still chunking, one the API
reports an error for, one missing from the listing, a listing that could not be
read at all: each means "send it". The asymmetry is deliberate: a page wrongly
skipped is invisible until a reader gets a stale answer, while a page wrongly
uploaded costs two seconds. In practice this shows up right after a large sync,
where items sit at `status: "running"` while Cloudflare chunks them (15 of 22
completed within two minutes and 7 took several more), and those are re-sent
until they finish. `npm run index:sync -- --force` ignores the digests entirely.

> **Note: Not the API's own checksum field**
>
> The listing endpoint returns a `checksum` per item, which looks like it would
> do this job. Measured against a live instance of 198 items, it never equals the
> digest of the uploaded file under any derivation, and 128 of them reported the
> literal string `"0"`, exactly the items that run had _created_ rather than
> overwritten. The split did not resolve minutes later, with every item reporting
> `status: "completed"`. A freshly created item simply has none, which fails
> precisely when it matters most: the moment after a sync is when you most want
> to ask what the index holds.
>
> `file_size` does come back correctly on every item. It is a weak signal: an
> edit that preserves length slips through, and translation round trips produce
> plenty of those. So it is not used either.

### Heading paths are plain text

The outline is built from raw Markdown. Because of this, a decorated heading
such as `### **2. Update the DNS**`, common in migrated content, used to
reach the agent as `****2. Update the DNS****`. This leaked Markdown syntax
into a JSON string that nothing renders, and that a model might quote back
verbatim.

It also broke the anchor, which is the more important effect. Anchors are
matched against the renderer's own heading text, which carries no asterisks.
So every decorated heading missed the lookup and fell back to a computed
slug. This usually agreed with the real anchor by accident, since
slugification drops the punctuation anyway. But on a page that repeats a
heading, the renderer disambiguates the second one as `…-1`, while the
fallback always produced the first. A deep link to the second occurrence
then pointed silently at the first.

The fix strips inline Markdown from heading text before either use. The slug
lookup now keeps every anchor as the text produced it, in document order,
picked by occurrence. Underscores are deliberately left alone: `_emphasis_`
in a heading is rare, but `list_pages` in a heading is not.
