import { agents, site } from '../../src/docs.config';
import type { Env } from './corpus';

/**
 * Retrieval, behind one interface with two implementations.
 *
 * The split exists because the two have very different operational costs and
 * the right answer depends on the deployment, not on the code:
 *
 *   lexical    scores the build's own search index inside the Worker. No
 *              account setup, no provisioning, no external call, and it ships
 *              working. Good enough for a few hundred pages, which is most
 *              documentation sites.
 *   ai-search  Cloudflare AI Search: hybrid vector + keyword over the corpus
 *              pushed at build time. Better on paraphrased questions, needs an
 *              instance and a binding.
 *
 * `ai-search` degrades to `lexical` when the binding is missing rather than
 * failing: a half-finished setup should return slightly worse answers, not 500.
 */

/**
 * One retrieved passage, before it is located and grouped.
 *
 * The two backends know different things about a hit, and the tools layer
 * normalises them: AI Search hands back verbatim `text` whose position must be
 * recovered, while the lexical path knows the `anchor` of the section it
 * matched and lets the manifest supply both the position and the text.
 */
export interface Passage {
  pageId: string;
  text?: string;
  anchor?: string;
}

/** Shape of dist/search-index.json — see src/lib/navigation.ts. */
interface SearchIndex {
  pages: Array<{
    h: string;
    t: string;
    s: string;
    d: string;
    b: Array<{ a?: string; h?: string; t: string }>;
  }>;
}

let indexCache: Promise<SearchIndex | null> | null = null;

function loadSearchIndex(env: Env, origin: string): Promise<SearchIndex | null> {
  indexCache ??= env.ASSETS.fetch(new URL('/search-index.json', origin))
    .then(response => {
      if (!response.ok) throw new Error(`search-index.json: ${response.status}`);
      return response.json() as Promise<SearchIndex>;
    })
    .catch(error => {
      /* Clear the slot before rethrowing. Caching the failure would disable
         search for the life of the isolate over one transient read. */
      indexCache = null;
      throw error;
    });
  /*
   * Swallowed so a broken index degrades to "no results" rather than a 500 —
   * but never silently. This is the only retrieval path the open-source
   * template ever uses, so an unreadable search-index.json here would turn
   * every query on every deployment into a polite "nothing matched", which is
   * indistinguishable from an empty corpus and would sit unnoticed.
   */
  return indexCache.catch(error => {
    console.log(
      JSON.stringify({
        event: 'lexical-index-unavailable',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  });
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'for', 'on', 'with',
  'how', 'do', 'i', 'can', 'my', 'what', 'when', 'where', 'this', 'that', 'be',
  'are', 'from', 'by', 'as', 'at', 'if', 'not', 'you', 'your', 'we', 'does',
]);

/**
 * Crude English suffix stripping, so a query term matches its relatives.
 *
 * Without it "deployment" does not match a page titled "Deploy your site", and
 * the query lands on whichever page happens to repeat the exact word most —
 * which on a documentation site is reliably the API reference. Nothing here is
 * linguistics; it is the four suffixes that actually cost recall in technical
 * prose, applied only to words long enough that stripping cannot produce a
 * fragment that matches everything.
 */
function stem(word: string): string {
  for (const suffix of ['ments', 'ment', 'tions', 'tion', 'ing', 'ers', 'er', 'es', 's']) {
    if (word.length - suffix.length >= 4 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

interface Term {
  /** As typed, lowercased. */
  word: string;
  /** The stem, when it differs — a second, weaker thing to look for. */
  root?: string;
}

function terms(query: string): Term[] {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_.-]+/u)
    .filter(word => word.length > 1 && !STOP.has(word));

  return words.map(word => {
    const root = stem(word);
    return root !== word && root.length >= 4 ? { word, root } : { word };
  });
}

/** Whether a haystack carries this term, exactly or through its stem. */
const hits = (haystack: string, term: Term) =>
  haystack.includes(term.word) || (term.root ? haystack.includes(term.root) : false);

/** How many times, counting the stem only when the exact word is absent. */
function count(haystack: string, term: Term): number {
  const exact = haystack.split(term.word).length - 1;
  if (exact) return exact;
  return term.root ? haystack.split(term.root).length - 1 : 0;
}

/**
 * Scores one section of one page.
 *
 * Two corrections matter more than the weights. Occurrences are damped by the
 * square root of the section's length, because otherwise a long API reference
 * section beats a short, exactly-on-topic paragraph purely by repeating a word;
 * and coverage is measured on the *page*, because a question's terms are often
 * spread across a page's title and body rather than gathered in one section.
 */
function scoreSection(query: Term[], title: string, heading: string, body: string, pageCoverage: number): number {
  const inTitle = title.toLowerCase();
  const inHeading = heading.toLowerCase();
  const inBody = body.toLowerCase();
  /* Sections are capped at 4000 characters upstream, so this stays in a narrow
     band; the point is only to stop length itself being a ranking signal. */
  const damp = Math.sqrt(Math.max(body.length, 200) / 200);

  let score = 0;
  let covered = 0;

  for (const term of query) {
    let termScore = 0;
    if (hits(inTitle, term)) termScore += 7;
    if (hits(inHeading, term)) termScore += 6;
    const occurrences = count(inBody, term);
    if (occurrences) termScore += Math.min(occurrences, 5) / damp;
    if (termScore) covered += 1;
    score += termScore;
  }

  if (!score) return 0;

  /* A section that answers the whole question outranks one that answers part of
     it loudly. Squared so the gap widens as more of the query is matched. */
  score *= (covered / query.length) ** 2 + 0.25;

  /* And a section on a page that covers the question everywhere outranks an
     equally good section on a page that mentions the topic once. */
  score *= 1 + pageCoverage;

  return score;
}

async function lexical(env: Env, origin: string, query: string, limit: number): Promise<Passage[]> {
  const index = await loadSearchIndex(env, origin);
  if (!index) return [];

  const parsed = terms(query);
  if (!parsed.length) return [];

  const hitList: Array<{ pageId: string; anchor?: string; score: number }> = [];

  for (const page of index.pages) {
    /*
     * `h` is the href, and the page id is that path without its leading slash —
     * minus `site.basePath`, which the href carries and the id never does.
     *
     * Dropping the prefix here is not cosmetic. The id is the join key to the
     * build manifest, so under a subpath deployment every lookup missed and
     * search returned nothing at all, with no error to explain it: the index
     * loaded, the scoring ran, and every hit was discarded for naming a page
     * that did not exist.
     */
    const href = site.basePath && page.h.startsWith(site.basePath)
      ? page.h.slice(site.basePath.length)
      : page.h;
    const pageId = href.replace(/^\//, '') || 'index';

    /* Page-level coverage, computed once: the share of query terms the page
       carries anywhere at all. */
    const whole = `${page.t} ${page.d} ${page.b.map(section => `${section.h ?? ''} ${section.t ?? ''}`).join(' ')}`.toLowerCase();
    const pageCoverage = parsed.filter(term => hits(whole, term)).length / parsed.length;

    for (const section of page.b) {
      const score = scoreSection(parsed, page.t, section.h ?? '', section.t ?? '', pageCoverage);
      if (score > 0) hitList.push({ pageId, anchor: section.a, score });
    }
  }

  hitList.sort((a, b) => b.score - a.score);
  return hitList.slice(0, limit).map(hit => ({ pageId: hit.pageId, anchor: hit.anchor }));
}

/**
 * Cosine similarity below which a vector-only hit is treated as noise.
 *
 * Calibrated on 28 measured queries against this corpus: 12 real questions
 * using the documentation's own vocabulary, 8 real questions deliberately
 * phrased without it, and 8 that the documentation cannot answer at all.
 *
 * The two populations overlap, so no threshold separates them cleanly. The
 * lowest-scoring genuine question ("my app looks wrong on a phone" → styling,
 * 0.541) sits *below* the highest-scoring nonsense one ("quantum blockchain
 * zebra", 0.572). Anything strict enough to cut the second also cuts the first,
 * and worse: at 0.58 three real questions are lost to gain that one block.
 *
 *   0.50   keeps every real question, blocks 6 of 8
 *   0.54   keeps every real question, blocks 7 of 8   ← here
 *   0.58   loses 3 real questions,     blocks 8 of 8
 *
 * 0.54 is the last point before the curve turns: the most filtering available
 * without discarding anything genuine. The one survivor is accepted, because a
 * caller reading three plainly unrelated passages draws the right conclusion,
 * whereas it cannot reason about an answer it never received.
 *
 * Questions phrased in the documentation's own terms almost always also match
 * the keyword pass, which the rule below keeps regardless of vector score — so
 * this threshold really only governs the paraphrased case.
 *
 * Re-run the calibration before moving it; the numbers above are the argument,
 * not the value itself.
 */
const MIN_VECTOR_SIMILARITY = 0.54;

/**
 * BM25 score below which a keyword match is treated as incidental.
 *
 * The keyword pass runs in `or` mode, so a single common word shared with the
 * query is enough to produce a hit. Without a floor, "mortgage interest rate"
 * matches every page containing "rate" — including the API rate-limiting
 * reference — and the keyword clause then rescues them all from the vector
 * threshold above.
 *
 * Measured on this corpus: a genuine technical term scored 11.9–25 ("CNAME DNS
 * error"), an incidental word 7.4–11.2 ("mortgage interest rate"). The two
 * nearly touch, which is why this is a floor and not a decision — it removes
 * the clearly incidental and leaves the rest to the vector threshold.
 *
 * BM25 is unbounded and depends on term rarity and query length, so this
 * number does not transfer to another corpus. Re-measure rather than reuse.
 */
const MIN_KEYWORD_SCORE = 12;

async function aiSearch(env: Env, query: string, limit: number): Promise<Passage[]> {
  const response = await env.AI_SEARCH!.search({
    query,
    ai_search_options: {
      /* Generation is the only billed step and we never generate. */
      query_rewrite: { enabled: false },
      /* Off by decision: it is a cross-encoder pass whose only payoff would be
         a publishable relevance number, and no number is published. Leaving it
         off also frees `rrf`, which ranks better than `max`. */
      reranking: { enabled: false },
      retrieval: {
        retrieval_type: 'hybrid',
        fusion_method: 'rrf',
        keyword_match_mode: 'or',
        max_num_results: limit,
        /*
         * Set explicitly rather than left to the instance default. `rrf`
         * scores are sums of reciprocal ranks — with the standard k=60
         * formula, even a rank-1 hit on both signals tops out around 0.03 —
         * nothing like the 0.3–0.5 range a cosine-similarity threshold would
         * suggest. The dashboard's own smart default (0.4) would silently
         * return zero results for every query under this fusion method.
         * Pinning a low value here means the behaviour does not depend on
         * whatever an instance happens to be configured with.
         */
        match_threshold: 0.001,
      },
    },
  });

  return (response.chunks ?? response.result?.chunks ?? [])
    /*
     * Drop results that only look like answers.
     *
     * The fusion score cannot do this job: it is normalised against whatever
     * this query happened to return, so a query the corpus has no answer for
     * still produces a 1.0 at the top. Measured on this corpus, a nonsense
     * query ("quantum blockchain zebra") scores 0.53–0.57 on fusion — higher
     * than the third real hit of a genuine question.
     *
     * The cosine similarity behind it does not have that problem: it compares
     * two embeddings and means the same thing from one query to the next.
     * Genuine hits sat at 0.71–0.74, nonsense at 0.44–0.57, so the gap is wide
     * and the threshold sits in it.
     *
     * A chunk the keyword pass matched is kept regardless: an exact identifier
     * is evidence in itself, and those legitimately score zero on vectors —
     * the CNAME answer on this corpus is exactly that case.
     */
    .filter(chunk => {
      const vector = chunk.scoring_details?.vector_score ?? 0;
      const keyword = chunk.scoring_details?.keyword_score ?? 0;
      return vector >= MIN_VECTOR_SIMILARITY || keyword >= MIN_KEYWORD_SCORE;
    })
    .map(chunk => ({
      /*
       * The Items API stores the key as the uploaded filename, `.md` and all —
       * confirmed against the live instance, where a page uploaded with
       * `key: page.id` still comes back as `item.key: "faq/domain-setup.md"`.
       * The manifest indexes pages by `page.id` with no extension, so without
       * stripping this every AI Search hit would silently fail to match any
       * page and `consolidate()` would return nothing for every query.
       */
      pageId: (chunk.item?.key ?? '').replace(/\.md$/, ''),
      text: chunk.text ?? '',
    }))
    .filter(passage => passage.pageId && passage.text);
}

/**
 * Ordered passages, best first. The ordering is the whole ranking signal — no
 * score is returned, because neither backend produces one an agent could
 * interpret, and an uninterpretable number invites false confidence.
 */
export async function retrieve(
  env: Env,
  origin: string,
  query: string,
  limit: number,
): Promise<{ passages: Passage[]; backend: 'lexical' | 'ai-search' }> {
  if (agents.retrieval === 'ai-search' && env.AI_SEARCH) {
    try {
      /*
       * An empty result is an answer, not a failure — and the difference
       * matters. Falling back to lexical here would undo the quality filter
       * above: the semantic pass would correctly conclude the corpus has
       * nothing on apple pie, and the lexical pass would then serve six pages
       * about something else. "No results" is the honest reply, and an agent
       * handles it better than a plausible wrong one.
       *
       * Only a thrown error reaches the fallback below, because that means
       * retrieval was unavailable rather than unfruitful.
       */
      return { passages: await aiSearch(env, query, limit), backend: 'ai-search' };
    } catch (error) {
      /* Fall through: a retrieval outage should degrade, not take the tool
         down. The lexical path needs no network beyond an asset read. */
      console.log(
        JSON.stringify({
          event: 'ai-search-failed',
          query,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return { passages: await lexical(env, origin, query, limit), backend: 'lexical' };
}
