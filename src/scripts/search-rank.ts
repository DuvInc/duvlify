/**
 * Which pages answer a search, and in which order.
 *
 * Free of any DOM so it runs under Node: `test/search-rank.test.mjs` imports it,
 * `src/pages/404.astro` reuses it to suggest pages for a path that does not
 * exist, and the Worker scores its lexical retrieval through `passages()`. One
 * ranking, three callers, so the answer an agent gets and the answer a reader
 * gets cannot drift apart.
 *
 * The rules, in the order they matter:
 *
 *   1. A word matches at a word boundary, not inside another word. "api" finds
 *      "API authentication" and "apiPath", and stops finding "capital". The
 *      boundary gives type-ahead for free: a longer word that starts with the
 *      typed one still matches, which is how "deplo" reaches "Deploying".
 *   2. A word matches through its stem, so "deployment" reaches "deploy". A
 *      handful of suffixes only (see `stem`), no linguistics: getting a word's
 *      family wrong is worse than missing a cousin.
 *   3. Words that carry no meaning are dropped from the query, not from the
 *      index: "how do I add a page" is the query "add page". A query made only
 *      of them keeps them, since otherwise it would match everything.
 *   4. A page must contain EVERY remaining word. A page with some of them is
 *      noise that happens to share a word ("api key" must not return every page
 *      that says "API"). When nothing contains all of them, a second pass takes
 *      the pages that contain most of them, penalised by how much they miss, so
 *      a near miss still shows something instead of an empty dialog.
 *   5. Each word scores by the best place it appears: the title (100), a
 *      heading (45), the description (22), the URL path or sidebar section
 *      (18), the body (12). So a page that names the thing in its title beats a
 *      page that merely mentions it, however many times.
 *   6. A rare word outranks a common one. "page" appears on most pages of a
 *      documentation site and should decide little; without this, a query with
 *      one distinctive and one common word is ordered by the common one.
 *   7. The exact phrase earns a bonus on top, larger where it sits higher, and
 *      words that share a section outrank words scattered across a page.
 *   8. A word the corpus has never seen is corrected against the corpus
 *      vocabulary when a close one exists ("frontmatr" → "frontmatter"), and the
 *      hit carries `corrected`, so the interface can say which question it
 *      answered instead of silently answering a different one.
 *   9. Ties go to the shorter title, which is the more specific page. Ordering
 *      ties alphabetically is how "stripe" once returned ActiveCampaign first.
 *
 * Each page yields one hit. If the title answers the query, the hit is the page.
 * Otherwise the best-scoring section deep-links to its heading, and failing that
 * the page.
 */

export interface Section {
  /** Heading anchor, so a result can deep-link into the page. */
  a?: string;
  /** Heading text. Absent for a page's opening prose. */
  h?: string;
  /** Plain-text body under that heading. */
  t: string;
}
export interface Page {
  h: string;
  t: string;
  s: string;
  d: string;
  /** Endpoint pages are drawn with a method badge. */
  k?: 'page' | 'endpoint';
  m?: string;
  b: Section[];
}
export interface QuickLink {
  h: string;
  t: string;
  s: string;
  k?: 'page' | 'endpoint';
  m?: string;
}
export interface Index {
  /** The shortcuts shown before anything is typed. The Worker's copy omits them. */
  quick?: QuickLink[];
  pages: Page[];
}

export interface Hit {
  href: string;
  title: string;
  /** The second line of the result row: where it is, and/or what it says. */
  meta: string;
  score: number;
  kind: 'page' | 'endpoint' | 'heading';
  method?: string;
  /**
   * The query as it was actually searched, when a word in it was corrected.
   * Present so the interface can say which words it answered.
   */
  corrected?: string;
}

/** A scored section, which is what the Worker's lexical retrieval hands back. */
export interface Passage {
  page: Page;
  section: Section;
  score: number;
}

const WEIGHT = { title: 100, heading: 45, description: 22, place: 18, body: 12 } as const;

/** A phrase bonus, by the best field the whole phrase appears in. */
const PHRASE = { title: 50, heading: 22, description: 18, body: 8 } as const;

/**
 * Words a question is made of rather than about. English first, because this
 * framework's own documentation is English; French follows, because the sites
 * built on it are often French, and a stop list that helps one of the two is a
 * bug waiting to be reported.
 */
const STOP = new Set(
  (
    'a an and are as at be been being but by can could did do does doing for from had has have how i if in into is it ' +
    'its just me my no not of on or our should so than that the their them then there these they this to too was we ' +
    'were what when where which who why will with would you your ' +
    'au aux avec ce ces comment dans de des du elle en est et il je la le les leur lui mais mes mon ne nous on ou par ' +
    'pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous'
  ).split(/\s+/),
);

/**
 * The suffixes worth stripping, longest first so `-ations` never becomes
 * `-ation` plus a stray `s`.
 *
 * Nothing here is linguistics. These are the families that actually cost recall
 * in technical prose: deploy/deployment/deployments, configure/configuration,
 * page/pages, reorder/reorders. Applied only when four characters survive, so
 * "css" and "ios" are not mangled into a fragment that matches everything.
 */
const SUFFIXES = ['ments', 'ment', 'tions', 'tion', 'ing', 'ers', 'er', 'es', 's'];

/**
 * A result line is one row of clipped text, so the match has to appear early in
 * it: enough words before to give context, and the rest of the budget after.
 * Centring the match instead pushes it past the clip on a narrow dialog.
 */
const SNIPPET_LEAD = 34;
const SNIPPET_TRAIL = 150;

const WORD_CHAR = /[\p{L}\p{N}]/u;
const ASCII_WORD = /^[\x20-\x7e]+$/;

const isWordChar = (char: string | undefined) => char !== undefined && WORD_CHAR.test(char);

/**
 * Lower-cases, opens a boundary at a camelCase hump, and normalises hyphens,
 * underscores and slashes to spaces so compound terms like "Sign-in" match phrases.
 *
 * Without it the boundary rule hides the half of this documentation that is
 * written in identifiers: "MCP" is inside "WebMCP", "api" is inside "apiPath",
 * and a search for either finds nothing on the page that is about it. Splitting
 * before lower-casing is the whole trick: the capitals are the boundary, and
 * they are gone afterwards.
 */
const fold = (text: string) =>
  text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_/]+/g, ' ')
    .toLowerCase();

/** The words of a query, lower-cased, with duplicates dropped. */
export const wordsOf = (query: string): string[] => [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];

/** A window of body text opening just before the match, cut at word boundaries. */
export function snippetAround(text: string, at: number) {
  let start = Math.max(0, at - SNIPPET_LEAD);
  let end = Math.min(text.length, at + SNIPPET_TRAIL);
  if (start > 0) start = text.indexOf(' ', start) + 1 || start;
  if (end < text.length) end = text.lastIndexOf(' ', end) + 1 || end;
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/**
 * One searchable field, in two forms: lower-cased with a boundary at every
 * camelCase hump, and plain lower-cased.
 *
 * The folded form is what lets "mcp" find "WebMCP". The plain form is what lets
 * "webmcp" find it too, since folding splits a word the reader typed whole. Both
 * are tried, folded first, and the second one costs nothing when the first
 * already answered.
 */
interface Field {
  folded: string;
  plain: string;
}

const asField = (text: string): Field => ({ folded: fold(text), plain: text.toLowerCase() });

/** Occurrences of `word` in an already lower-cased text, by how they line up. */
function occurrences(text: string, word: string): { exact: number; prefix: number } {
  let exact = 0;
  let prefix = 0;
  let at = text.indexOf(word);
  while (at !== -1) {
    if (at === 0 || !isWordChar(text[at - 1])) {
      if (isWordChar(text[at + word.length])) prefix += 1;
      else exact += 1;
    }
    at = text.indexOf(word, at + 1);
  }
  return { exact, prefix };
}

function stem(word: string): string {
  for (const suffix of SUFFIXES) {
    if (word.length - suffix.length >= 4 && word.endsWith(suffix)) return word.slice(0, -suffix.length);
  }
  return word;
}

interface Term {
  /** As typed, lower-cased. */
  word: string;
  /** The stem, when it differs and is long enough to mean something. */
  root?: string;
  /** 1 for a word that appears once, down to 0.3 for one on every page. */
  idf: number;
}

/**
 * How well one field carries one term: 1 for the word itself, less for a longer
 * word that starts with it or shares its stem.
 *
 * Scripts without spaces take the substring path, because a word boundary is a
 * concept their text does not have and the boundary rule would find nothing in
 * a Japanese page.
 */
function qualityOf(text: string, term: { word: string; root?: string }): number {
  if (!text) return 0;
  const found = occurrences(text, term.word);
  if (found.exact) return 1;
  if (term.word.length >= 3 && found.prefix) return 0.7;
  if (term.root) {
    const root = occurrences(text, term.root);
    if (root.exact || root.prefix) return 0.6;
  }
  if (!ASCII_WORD.test(term.word) && text.includes(term.word)) return 0.7;
  return 0;
}

/** The better of the field's two forms, without paying for the second one twice. */
function fieldQuality(field: Field, term: { word: string; root?: string }): number {
  const folded = qualityOf(field.folded, term);
  if (folded === 1 || field.folded === field.plain) return folded;
  return Math.max(folded, qualityOf(field.plain, term));
}

/** How many times a field carries a term, for term frequency inside a section. */
function countOf(field: Field, term: Term): number {
  const found = occurrences(field.folded, term.word);
  const direct = found.exact + found.prefix;
  if (direct) return direct;
  if (!term.root) return 0;
  const root = occurrences(field.folded, term.root);
  return root.exact + root.prefix;
}

/** Whether the whole phrase appears at an exact word boundary. */
function phraseQuality(field: Field, phrases: string[]): number {
  for (const phrase of phrases) {
    if (!phrase.includes(' ')) continue;
    for (const text of field.folded === field.plain ? [field.folded] : [field.folded, field.plain]) {
      const found = occurrences(text, phrase);
      if (found.exact > 0) return 1;
    }
  }
  return 0;
}

/* ---------------------------------------------------------------- the index */

interface PreparedSection {
  section: Section;
  heading: Field;
  body: Field;
}

interface PreparedPage {
  page: Page;
  title: Field;
  place: Field;
  description: Field;
  sections: PreparedSection[];
  /** Every field, for document frequency and the coarse prefilter. */
  whole: Field;
}

interface PreparedIndex {
  pages: PreparedPage[];
  /** Lower-cased words of the whole corpus, with how often each appears. */
  vocabulary: Map<string, number> | null;
}

/**
 * The index prepared once per session: lower-cased fields and one concatenated
 * text per page.
 *
 * Built lazily and cached against the index object, because this runs again on
 * every keystroke: lower-casing 200 KB of prose per letter typed is the
 * difference between instant and noticeable on a phone.
 */
const preparedIndexes = new WeakMap<Index, PreparedIndex>();

function prepare(index: Index): PreparedIndex {
  const cached = preparedIndexes.get(index);
  if (cached) return cached;

  const pages = index.pages.map(page => {
    const sections = page.b.map(section => ({
      section,
      heading: asField(section.h ?? ''),
      body: asField(section.t),
    }));
    const place = `${page.h} ${page.s}`;
    return {
      page,
      title: asField(page.t),
      place: asField(place),
      description: asField(page.d),
      sections,
      /* The path is part of `whole` because it is part of the answer: on this
         site "internationalization" lives in a URL and nowhere in the prose. */
      whole: asField([page.t, place, page.d, ...page.b.map(section => `${section.h ?? ''} ${section.t}`)].join(' ')),
    };
  });

  const result: PreparedIndex = { pages, vocabulary: null };
  preparedIndexes.set(index, result);
  return result;
}

/**
 * The correction vocabulary: every word the corpus contains, built from the full
 * text the first time a query needs it, then kept.
 *
 * Full text rather than titles and headings, because the word a reader mistyped
 * is often one that only appears in prose, and a vocabulary too small to contain
 * it turns every typo into no result.
 */
function vocabulary(index: Index): Map<string, number> {
  const ready = prepare(index);
  if (ready.vocabulary) return ready.vocabulary;

  const words = new Map<string, number>();
  for (const entry of ready.pages) {
    /* Both forms: the plain one holds "webmcp", the folded one holds "web" and
       "mcp", and a correction may need either. */
    for (const text of entry.whole.folded === entry.whole.plain ? [entry.whole.folded] : [entry.whole.folded, entry.whole.plain]) {
      for (const word of text.split(/[^\p{L}\p{N}]+/u)) {
        if (word.length > 2) words.set(word, (words.get(word) ?? 0) + 1);
      }
    }
  }
  ready.vocabulary = words;
  return words;
}

/**
 * Edit distance, abandoned once it passes `max`.
 *
 * Damerau rather than plain Levenshtein: swapping two letters is the most common
 * typo there is ("mermiad"), and charging it as two edits puts it out of reach of
 * a correction that should be trivial.
 */
function distance(a: string, b: string, max: number): number {
  const cols = b.length + 1;
  let twoBack = new Int32Array(cols);
  let previous = new Int32Array(cols);
  let current = new Int32Array(cols);
  for (let j = 0; j < cols; j += 1) previous[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = i;
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, twoBack[j - 2] + 1);
      }
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    const recycled = twoBack;
    twoBack = previous;
    previous = current;
    current = recycled;
  }
  return previous[cols - 1];
}

/**
 * The closest word the corpus actually contains, or nothing.
 *
 * Two edits from nine characters up, one below that, and short words are left
 * alone entirely: "nuxt" and "react" are one edit away from words this corpus
 * happens to contain, and answering a product name with an unrelated page is
 * worse than answering nothing.
 *
 * A misspelling of a real word is not a truncation of one. "stripe" is one edit
 * from "strip", and nothing about the distance knows the reader meant Stripe, so
 * a candidate that is simply the typed word cut short is rejected.
 */
function closest(word: string, words: Map<string, number>): string | null {
  const max = word.length >= 9 ? 2 : word.length >= 6 ? 1 : 0;
  if (!max) return null;

  const truncation = (a: string, b: string) => (a.length > b.length ? a.startsWith(b) : b.startsWith(a));

  /* Two words that differ only in their last letter are two words, not one word
     and a typo: "stripe" is not "strips". */
  const lastLetterOnly = (a: string, b: string) => {
    if (a.length !== b.length || a.length < 5) return false;
    return a.slice(0, -1) === b.slice(0, -1);
  };

  let best: { word: string; distance: number; uses: number } | null = null;
  for (const [candidate, uses] of words) {
    if (Math.abs(candidate.length - word.length) > max) continue;
    if (truncation(word, candidate) || lastLetterOnly(word, candidate)) continue;
    const d = distance(word, candidate, max);
    if (d > max) continue;
    const better =
      !best ||
      d < best.distance ||
      (d === best.distance && uses > best.uses) ||
      (d === best.distance && uses === best.uses && candidate.length < best.word.length);
    if (better) best = { word: candidate, distance: d, uses };
  }
  return best?.word ?? null;
}

interface Analysis {
  terms: Term[];
  phrases: string[];
  /** Set when at least one word was replaced by a near one from the corpus. */
  corrected?: string;
}

function analyze(index: Index, rawQuery: string): Analysis {
  const raw = rawQuery.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!raw) return { terms: [], phrases: [] };

  const typed = raw.split(/\s+/).filter(Boolean);
  const meaningful = typed.filter(word => !STOP.has(word));
  /* A query made only of stop words keeps them: dropping every word would make
     "the" match the entire documentation. */
  const kept = [...new Set(meaningful.length ? meaningful : typed)];

  const ready = prepare(index);
  const pageCount = ready.pages.length || 1;

  let corrected: string | undefined;
  const words = kept.map(word => {
    if (ready.pages.some(page => fieldQuality(page.whole, { word }) > 0)) return word;
    const near = closest(word, vocabulary(index));
    if (!near || near === word) return word;
    corrected = (corrected ?? raw).replace(word, near);
    return near;
  });

  const terms: Term[] = [...new Set(words)].map(word => {
    const root = stem(word);
    const df = ready.pages.filter(
      page => page.whole.plain.includes(word) || (root !== word && page.whole.plain.includes(root)),
    ).length;
    /* 1 for a word on one page, 0.3 for one on every page. `log` keeps a large
       corpus from making every rare word look equally rare. */
    const idf = df ? 0.3 + 0.7 * (Math.log(1 + pageCount / df) / Math.log(1 + pageCount)) : 1;
    return root !== word && root.length >= 4 ? { word, root, idf } : { word, idf };
  });

  const multiPhrases = [raw, [...new Set(words)].join(' ')].filter(phrase => phrase.includes(' '));
  const phrases = [...new Set(multiPhrases)];
  return { terms, phrases, corrected };
}

/* -------------------------------------------------------------- the scoring */

interface ScoredPage {
  prepared: PreparedPage;
  score: number;
  /** How many of the query's terms the page contains at all. */
  coverage: number;
  sections: ScoredSection[];
}

interface ScoredSection {
  prepared: PreparedSection;
  /**
   * What each query term contributes to this section, by term index. Kept apart
   * rather than summed because the deep link is better chosen over the terms the
   * page title does not already answer.
   */
  terms: number[];
  score: number;
}

function evaluate(prepared: PreparedPage, terms: Term[], phrases: string[]): ScoredPage {
  const { title, place, description, sections } = prepared;
  const sectionTerms = sections.map((): number[] => terms.map(() => 0));

  let score = 0;
  let coverage = 0;
  let idfTotal = 0;

  terms.forEach((term, termIndex) => {
    idfTotal += term.idf;
    let best = 0;

    const inTitle = fieldQuality(title, term);
    if (inTitle) best = Math.max(best, WEIGHT.title * inTitle * term.idf);
    const inDescription = fieldQuality(description, term);
    if (inDescription) best = Math.max(best, WEIGHT.description * inDescription * term.idf);
    const inPlace = fieldQuality(place, term);
    if (inPlace) best = Math.max(best, WEIGHT.place * inPlace * term.idf);

    sections.forEach((entry, index) => {
      const inHeading = fieldQuality(entry.heading, term);
      const inBody = fieldQuality(entry.body, term);
      if (!inHeading && !inBody) return;
      /* Repetition inside one section counts, but flattening: the fourth mention
         of a word is not four times the evidence that the section is about it. */
      const repetition = 1 + Math.min(Math.max(countOf(entry.body, term) - 1, 0), 4) * 0.15;
      const headingScore = WEIGHT.heading * inHeading;
      const bodyScore = WEIGHT.body * inBody * repetition;
      if (headingScore) best = Math.max(best, headingScore * term.idf);
      if (bodyScore) best = Math.max(best, bodyScore * term.idf);
      const contribution = (headingScore + bodyScore) * term.idf;
      sectionTerms[index][termIndex] = contribution;
    });

    if (!best) return;
    coverage += 1;
    score += best;
  });

  if (!coverage) return { prepared, score: 0, coverage: 0, sections: [] };

  const idfAverage = idfTotal / terms.length;

  /* The phrase, where it sits highest. A one-word query adds nothing here: it is
     the same word again, already counted. */
  if (phrases.some(phrase => phrase.includes(' '))) {
    if (phraseQuality(title, phrases)) score += PHRASE.title * idfAverage;
    else if (phraseQuality(description, phrases)) score += PHRASE.description * idfAverage;
    else {
      let bonus = 0;
      for (const entry of sections) {
        if (phraseQuality(entry.heading, phrases)) bonus = Math.max(bonus, PHRASE.heading);
        else if (phraseQuality(entry.body, phrases)) bonus = Math.max(bonus, PHRASE.body);
      }
      score += bonus * idfAverage;
    }
  }

  const scored = sections.map((entry, index) => ({
    prepared: entry,
    terms: sectionTerms[index],
    score: sectionTerms[index].reduce((sum, value) => sum + value, 0),
  }));

  /* Words that share a section are better evidence than the same words spread
     over a long page, which is most of what a documentation page is. */
  score += Math.max(0, ...scored.map(entry => entry.score)) * 0.2;

  return { prepared, score, coverage, sections: scored };
}

function hitOf(scored: ScoredPage, terms: Term[], corrected?: string): Hit {
  const { page } = scored.prepared;
  const meta = `${page.s} · ${page.d}`;
  const kind = page.k ?? 'page';
  const shared = { score: scored.score, method: page.m, corrected };

  const inTitle = terms.map(term => fieldQuality(scored.prepared.title, term) > 0);
  if (inTitle.every(Boolean)) return { href: page.h, title: page.t, meta, kind, ...shared };

  /* The deep link answers what the title does not. On a page titled "Deploying"
     the question "deploy to cloudflare" should land on the Cloudflare section,
     not on whichever section happens to repeat "deploy" most. */
  const missing = inTitle.map((found, index) => (found ? -1 : index)).filter(index => index >= 0);
  const bestIn = (indices: number[]) =>
    scored.sections
      .map(entry => ({ entry, sum: indices.reduce((total, index) => total + entry.terms[index], 0) }))
      .filter(candidate => candidate.sum > 0)
      .sort((a, b) => b.sum - a.sum)[0]?.entry;

  const best = bestIn(missing) ?? bestIn(scored.sections.map((_, index) => index));
  if (!best) return { href: page.h, title: page.t, meta, kind, ...shared };

  const { section, heading, body } = best.prepared;
  const href = section.a ? `${page.h}#${section.a}` : page.h;

  /* A heading that answers the whole query links straight to it. */
  if (section.h && terms.every(term => fieldQuality(heading, term) > 0)) {
    return { href, title: section.h, meta: `${page.t} · ${page.s}`, kind: 'heading', ...shared };
  }

  const at = terms
    .map(term => {
      /* Positions come from the folded copy, which is one character longer at
         every camelCase hump; the snippet is cut out of the original, so look the
         word up again there and only fall back to the folded position. */
      const exact = section.t.toLowerCase().indexOf(term.word);
      return exact >= 0 ? exact : body.plain.indexOf(term.word);
    })
    .filter(index => index >= 0 && index < section.t.length)
    .sort((a, b) => a - b)[0];

  return {
    href,
    title: section.h ? `${page.t} · ${section.h}` : page.t,
    /* The title line already says where this is, so the whole second line goes
       to the sentence that matched. */
    meta: at === undefined ? meta : snippetAround(section.t, at),
    kind,
    ...shared,
  };
}

/**
 * The pages that answer a query, best first.
 *
 * Every page is scored, then the ones that contain all the words are kept. Only
 * when none does is the relaxed pass used, because a partial match is a worse
 * answer than a full one and must never outrank it.
 */
export function rank(index: Index, rawQuery: string, limit = 20): Hit[] {
  const { terms, phrases, corrected } = analyze(index, rawQuery);
  if (!terms.length) return [];

  const ready = prepare(index);
  const scored = ready.pages.map(page => evaluate(page, terms, phrases));
  const full = scored.filter(page => page.coverage === terms.length);

  const wanted = Math.max(1, Math.ceil(terms.length * 0.6));
  const pool = full.length
    ? full
    : scored
        .filter(page => page.coverage >= wanted)
        .map(page => ({ ...page, score: page.score * (page.coverage / terms.length) ** 2 }));

  return pool
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.prepared.page.t.length - b.prepared.page.t.length ||
        a.prepared.page.t.localeCompare(b.prepared.page.t),
    )
    .slice(0, limit)
    .map(page => hitOf(page, terms, corrected));
}

/**
 * The scored sections a query answers, best first, which is what an agent reads.
 *
 * Same scoring as `rank`, different question: a reader wants the page, an agent
 * wants the passage, and the passage is the section the page-level hit would
 * have deep-linked to. Pages that carry none of the words are skipped.
 */
export function passages(index: Index, rawQuery: string, limit = 20): Passage[] {
  const { terms, phrases } = analyze(index, rawQuery);
  if (!terms.length) return [];

  const ready = prepare(index);
  const found: Passage[] = [];
  for (const page of ready.pages) {
    const scored = evaluate(page, terms, phrases);
    if (!scored.coverage) continue;
    /* Same penalty as the relaxed pass in `rank`: a section on a page that
       answers two words out of three ranks below one that answers all three. */
    const coverage = (scored.coverage / terms.length) ** 2;
    for (const entry of scored.sections) {
      if (entry.score > 0) found.push({ page: page.page, section: entry.prepared.section, score: entry.score * coverage });
    }
  }
  return found.sort((a, b) => b.score - a.score).slice(0, limit);
}
