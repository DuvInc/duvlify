import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
/* The search index's section splitter, imported so the anchor tests below
   exercise the shipped code. Node strips the types on import. */
import { toSections } from '../src/lib/plain-text.ts';

/**
 * The publication rules, asserted against a real build.
 *
 * These run over `dist` rather than over the navigation resolver directly, and
 * deliberately so. The rules are not one function's behaviour — they are an
 * agreement between eleven build outputs, and every past leak has been one
 * output disagreeing with the other ten. Unit-testing the resolver would prove
 * the resolver right and say nothing about whether the sitemap agrees with it.
 *
 * The cases are derived from the content directory rather than hard-coded, so
 * this file stays correct as pages are added, and so the same test file works
 * for every distribution built on this engine. A class with no pages in it is
 * reported rather than silently passing: "no draft pages exist" is a fact worth
 * seeing in the output, because it means the draft rule went unexercised.
 *
 * Run with `npm test`, which builds first.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const CONTENT = path.join(ROOT, 'content');

/** Every `key: value` on its own line in the leading `---` block. */
function frontmatter(source) {
  const block = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return {};
  const data = {};
  for (const line of block[1].split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (match) data[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return data;
}

function contentFiles(dir = CONTENT, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const next = path.join(dir, item.name);
    if (item.isDirectory()) return contentFiles(next, `${prefix}${item.name}/`);
    if (!/\.mdx?$/.test(item.name)) return [];
    const id = `${prefix}${item.name.replace(/\.mdx?$/, '')}`;
    const data = frontmatter(readFileSync(next, 'utf8'));
    return [{
      id,
      data,
      draft: data.draft === 'true',
      noindex: data.noindex === 'true',
      isApiEndpoint: data.pageType === 'api-endpoint',
    }];
  });
}

/**
 * The content id served at the site root, when the distribution configures one.
 *
 * A configured homepage is published like any other page but routed, listed and
 * illustrated differently: it lives at `/` rather than at its id's path, and it
 * is deliberately outside the sidebar, so it gets no generated share card. Read
 * from the config rather than assumed, because one of the two distributions on
 * this engine sets it and the other does not.
 */
function homePageId() {
  const config = readFileSync(path.join(ROOT, 'src', 'docs.config.ts'), 'utf8');
  return config.match(/homePageId:\s*'([^']+)'/)?.[1];
}

let pages, outputs, home;

before(() => {
  assert.ok(
    existsSync(path.join(DIST, 'sitemap.xml')),
    'dist/ is missing or incomplete — run `npm run build` first (npm test does this for you).',
  );

  pages = contentFiles();
  home = homePageId();
  const read = name => readFileSync(path.join(DIST, name), 'utf8');
  outputs = {
    sitemap: read('sitemap.xml'),
    llms: read('llms.txt'),
    llmsFull: read('llms-full.txt'),
    updates: read('updates.xml'),
    searchIndex: read('search-index.json'),
  };
});

/** Where a page id shows up in the build, when it is published. */
const isHome = id => id === home;
const html = id => (isHome(id) ? path.join(DIST, 'index.html') : path.join(DIST, id, 'index.html'));
const markdown = id => path.join(DIST, `${id}.md`);
/** The homepage sits outside the sidebar, and so outside the share-card set. */
const shareCard = id => (isHome(id) ? null : path.join(DIST, 'og', `${id}.png`));

/**
 * Matches the page's own URL, not a mention of the word in someone's prose.
 *
 * The trailing delimiter is what keeps `/platform` from matching
 * `/platform/search`, and the optional `.md` is there because llms.txt links
 * the Markdown twin while the sitemap links the page. A configured homepage is
 * listed as the bare origin, so its path segment is empty.
 */
const listsUrl = (text, id) => {
  const tail = isHome(id) ? '' : id;
  return new RegExp(
    `(^|["'\\s>(])https?://[^\\s"'<)]*/${tail}(\\.md|index\\.md)?(["'\\s<)]|$)`,
    'm',
  ).test(text);
};
/*
 * The prefix a subpath deployment puts on every generated URL. Read from the
 * config rather than assumed away, so this suite is valid for both topologies:
 * the paths inside `dist/` never move, but everything the build *prints* does.
 */
const BASE_PATH = readFileSync(path.join(ROOT, 'src', 'docs.config.ts'), 'utf8')
  .match(/^export const basePath = '([^']*)'/m)?.[1] ?? '';

const listsPath = (text, id) =>
  new RegExp(`"${BASE_PATH}${isHome(id) ? '/' : `/${id}`}"`).test(text);

describe('published pages', () => {
  test('are routed, mirrored as Markdown, and listed everywhere', () => {
    const published = pages.filter(page => !page.draft && !page.noindex);
    assert.ok(published.length > 0, 'no published pages found');

    for (const page of published) {
      assert.ok(existsSync(html(page.id)), `${page.id}: missing HTML route`);
      assert.ok(existsSync(markdown(page.id)), `${page.id}: missing Markdown twin`);
      const card = shareCard(page.id);
      if (card) assert.ok(existsSync(card), `${page.id}: missing share card`);
      assert.ok(listsUrl(outputs.sitemap, page.id), `${page.id}: absent from sitemap.xml`);
      assert.ok(listsUrl(outputs.llms, page.id), `${page.id}: absent from llms.txt`);
      assert.ok(listsPath(outputs.searchIndex, page.id), `${page.id}: absent from search-index.json`);
    }
  });
});

describe('draft pages', () => {
  test('leave no trace in the build', t => {
    const drafts = pages.filter(page => page.draft);
    if (!drafts.length) return t.skip('no page in content/ sets draft: true');

    for (const page of drafts) {
      assert.ok(!existsSync(html(page.id)), `${page.id}: draft was routed`);
      assert.ok(!existsSync(markdown(page.id)), `${page.id}: draft has a Markdown twin`);
      assert.ok(!existsSync(shareCard(page.id)), `${page.id}: draft has a share card`);
      assert.ok(!listsUrl(outputs.sitemap, page.id), `${page.id}: draft is in sitemap.xml`);
      assert.ok(!listsUrl(outputs.llms, page.id), `${page.id}: draft is in llms.txt`);
      assert.ok(!listsUrl(outputs.updates, page.id), `${page.id}: draft is in updates.xml`);
      assert.ok(!listsPath(outputs.searchIndex, page.id), `${page.id}: draft is in the search index`);

      /* The corpus is one long document with no per-page URLs, so the title is
         the only handle on it — and a leak here is the expensive one. */
      if (page.data.title) {
        assert.ok(
          !outputs.llmsFull.includes(`# ${page.data.title}\n`),
          `${page.id}: draft body is in llms-full.txt`,
        );
      }
    }
  });

  test('are still referenced by docs.config.ts without failing the build', t => {
    const drafts = pages.filter(page => page.draft);
    if (!drafts.length) return t.skip('no page in content/ sets draft: true');

    const config = readFileSync(path.join(ROOT, 'src', 'docs.config.ts'), 'utf8');
    const referenced = drafts.filter(page => config.includes(`'${page.id}'`));
    assert.ok(
      referenced.length > 0,
      'no draft page is named in the navigation config, so the silent-skip path is untested',
    );
  });
});

describe('noindex pages', () => {
  test('are published and reachable but withheld from discovery surfaces', t => {
    const hidden = pages.filter(page => page.noindex && !page.draft);
    if (!hidden.length) return t.skip('no page in content/ sets noindex: true');

    for (const page of hidden) {
      /* noindex is not draft: the page ships. */
      assert.ok(existsSync(html(page.id)), `${page.id}: noindex page was not routed`);
      assert.ok(existsSync(markdown(page.id)), `${page.id}: noindex page has no Markdown twin`);
      assert.match(
        readFileSync(html(page.id), 'utf8'),
        /<meta name="robots" content="noindex/,
        `${page.id}: missing the noindex robots directive`,
      );

      assert.ok(!listsUrl(outputs.sitemap, page.id), `${page.id}: noindex page is in sitemap.xml`);
      assert.ok(!listsUrl(outputs.llms, page.id), `${page.id}: noindex page is in llms.txt`);
      assert.ok(!listsUrl(outputs.updates, page.id), `${page.id}: noindex page is in updates.xml`);
    }
  });
});

describe('generated API endpoint pages', () => {
  test('are treated as ordinary published pages', t => {
    const endpoints = pages.filter(page => page.isApiEndpoint && !page.draft && !page.noindex);
    if (!endpoints.length) return t.skip('this distribution generates no API endpoint pages');

    for (const page of endpoints) {
      assert.ok(existsSync(html(page.id)), `${page.id}: missing HTML route`);
      assert.ok(existsSync(markdown(page.id)), `${page.id}: missing Markdown twin`);
      assert.ok(listsUrl(outputs.sitemap, page.id), `${page.id}: absent from sitemap.xml`);
      assert.ok(listsUrl(outputs.llms, page.id), `${page.id}: absent from llms.txt`);
    }
  });

  test('declare themselves as APIReference in structured data', t => {
    const endpoints = pages.filter(page => page.isApiEndpoint && !page.draft);
    if (!endpoints.length) return t.skip('this distribution generates no API endpoint pages');

    const page = endpoints[0];
    assert.match(
      readFileSync(html(page.id), 'utf8'),
      /"@type":"APIReference"/,
      `${page.id}: endpoint page is not typed as APIReference`,
    );
  });
});

describe('agent discovery surfaces', () => {
  test('llms.txt carries the configured agent instructions', () => {
    const config = readFileSync(path.join(ROOT, 'src', 'docs.config.ts'), 'utf8');
    if (!/agentInstructions:\s*\[\s*\n\s*'/.test(config)) return;
    assert.ok(outputs.llms.length > 200, 'llms.txt looks empty');
    assert.ok(
      outputs.llms.includes('Accept: text/markdown'),
      'llms.txt does not carry the agent instructions block',
    );
  });

  test('robots.txt no longer blocks the Markdown twins', () => {
    const robots = readFileSync(path.join(DIST, 'robots.txt'), 'utf8');
    assert.ok(!/Disallow:.*\.md/.test(robots), 'robots.txt still blocks .md');
  });

  test('the OpenAPI description is served exactly when one is configured', () => {
    const spec = path.join(DIST, 'openapi.json');

    /* Two OpenAPI documents can be in play and only one of them is this
       setting's business: the documented product's, at the origin root, and the
       documentation's own read-only one under /api/docs/, which the Worker
       generates and always advertises. A substring search for '/openapi.json'
       matches the tail of the second, so it reports a product spec on a site
       that has none — which is every site documenting something that is not a
       web API. Anchor the path instead. */
    const advertisesProductSpec = /https?:\/\/[^/\s)]+(\/[^/\s)]+)*?\/openapi\.json/.test(
      outputs.llms.replace(/https?:\/\/[^/\s)]+\S*?\/api\/docs\/openapi\.json/g, ''),
    );

    if (!existsSync(spec)) {
      assert.ok(
        !advertisesProductSpec,
        'llms.txt advertises an OpenAPI description that was not built',
      );
      return;
    }
    const parsed = JSON.parse(readFileSync(spec, 'utf8'));
    assert.ok(Object.keys(parsed.paths ?? {}).length > 0, 'an empty OpenAPI spec was published');
    assert.ok(advertisesProductSpec, 'llms.txt does not link the OpenAPI description');
  });

  test('updates.xml is a well-formed feed ordered newest first', t => {
    const stamps = [...outputs.updates.matchAll(/<entry>[\s\S]*?<updated>([^<]+)<\/updated>/g)]
      .map(match => Date.parse(match[1]));

    /* An entry needs a date, and dates come from each file's last commit. A
       corpus with no git history — a template downloaded as an archive, a fresh
       scaffold, content moved but not yet committed — legitimately produces an
       empty feed rather than inventing timestamps. That is the designed
       behaviour, so it is skipped rather than failed. */
    if (!stamps.length) {
      return t.skip('no page carries a date, so the feed is empty by design');
    }

    for (let i = 1; i < stamps.length; i += 1) {
      assert.ok(stamps[i - 1] >= stamps[i], 'updates.xml entries are not in descending date order');
    }
  });
});

/**
 * The Markdown twin is three artefacts at once: the `.md` route, the `fetch`
 * tool's payload, and what the indexer embeds. So what it repeats, it repeats
 * three times — and it used to repeat the title, the description and the URL,
 * each twice, in the first chunk of every page.
 */
/**
 * Every asset a page asks for is actually in the build.
 *
 * Cheap, and it closes a gap that is easy to fall into: Astro's `base` option
 * prefixes the URLs it generates for CSS, fonts and scripts, but this site
 * computes its own page links from `docs.config.ts` rather than from
 * `BASE_URL`. Setting `base` therefore moves the asset references and nothing
 * else, so every page loads with no stylesheet and no JavaScript while still
 * building cleanly, passing every other test, and rendering its text.
 */
describe('the build is internally consistent', () => {
  test('every asset a page references exists', () => {
    const id = JSON.parse(readFileSync(path.join(DIST, 'agent-manifest.json'), 'utf8')).pages.find(
      page => !isHome(page.id),
    ).id;
    const page = readFileSync(html(id), 'utf8');

    const referenced = [...page.matchAll(/(?:src|href)="(\/[^"]+\.(?:css|js|woff2?|svg|png))"/g)]
      .map(match => match[1])
      .filter((value, index, all) => all.indexOf(value) === index);

    assert.ok(referenced.length > 0, 'the page references no assets at all, which cannot be right');
    /* `dist/` holds the file without the prefix — the Worker strips it before
       the ASSETS lookup, so the test resolves the same way the runtime does. */
    const missing = referenced.filter(
      asset => !existsSync(path.join(DIST, BASE_PATH ? asset.replace(BASE_PATH, '') : asset)),
    );
    assert.deepEqual(missing, [], 'the page references assets that are not in the build');
  });
});

/**
 * The dialog that tells a *person* these docs are machine-readable.
 *
 * Tested because the last unwatched piece of this feature — the WebMCP bridge —
 * shipped broken and stayed broken, and nothing noticed. This is only static
 * markup, so the risk is lower, but a renamed hook or a lost gate would fail the
 * same way: silently, on a page that still looks right.
 */
describe('the agent access dialog', () => {
  const config = () => readFileSync(path.join(ROOT, 'src', 'docs.config.ts'), 'utf8');
  const anyArticle = () => {
    const id = JSON.parse(readFileSync(path.join(DIST, 'agent-manifest.json'), 'utf8')).pages.find(
      page => !isHome(page.id),
    ).id;
    return readFileSync(html(id), 'utf8');
  };

  test('renders once, with both of its triggers', () => {
    const page = anyArticle();
    assert.equal(
      (page.match(/data-agent-dialog/g) ?? []).length,
      1,
      'the dialog should be rendered exactly once per page',
    );
    /* The topbar button plus the page-menu entries. Below two, one of the two
       entry points has been lost. */
    assert.ok(
      (page.match(/data-agent-open/g) ?? []).length >= 2,
      'a page carries fewer than two ways to open the dialog',
    );
  });

  test('is absent entirely when the agent surfaces are off', () => {
    /* Both distributions ship `enabled: true`, so this asserts the gate exists
       rather than exercising it: a dialog rendered unconditionally would
       advertise endpoints the Worker does not serve. */
    const layout = readFileSync(path.join(ROOT, 'src', 'components', 'DocsLayout.astro'), 'utf8');
    assert.match(
      layout,
      /agents\.enabled\s*&&\s*<AgentAccess/,
      'DocsLayout renders the dialog without checking agents.enabled',
    );
  });

  test('shows this site’s own MCP URL, not a placeholder', () => {
    const page = anyArticle();
    const shown = page.match(/data-agent-copy="([^"]*\/mcp)"/)?.[1];
    assert.ok(shown, 'the dialog offers no MCP URL to copy');
    const canonical = page.match(/rel="canonical" href="([^"]+)"/)?.[1];
    assert.ok(canonical, 'the page has no canonical URL to compare against');
    assert.equal(
      shown,
      `${new URL(canonical).origin}${BASE_PATH}/mcp`,
      'the MCP URL in the dialog names a different host than the page itself',
    );
  });

  test('offers report_issue exactly when a feedback webhook is configured', () => {
    const configured = /webhook:\s*'https?:/.test(config());
    const page = anyArticle();
    const listed = page.includes('report_issue');
    assert.equal(
      listed,
      configured,
      configured
        ? 'a webhook is configured but the dialog does not list report_issue'
        : 'the dialog lists report_issue with no webhook to receive it',
    );
  });

  test('names the documentation in every heading it shows', () => {
    /* On a site documenting a product that has its own MCP server, a bare
       "Connect via MCP" reads as the product's. Every label says so. */
    const page = anyArticle();
    for (const label of ['Query these docs via MCP', 'Connect docs via MCP']) {
      assert.ok(page.includes(label), `the dialog no longer says "${label}"`);
    }
  });
});

/**
 * Heading paths are read by agents and quoted back to people, and their anchors
 * are what a deep link resolves to. Both come from raw Markdown, so both can
 * carry syntax that nothing renders.
 */
describe('manifest headings', () => {
  const manifest = () =>
    JSON.parse(readFileSync(path.join(DIST, 'agent-manifest.json'), 'utf8'));

  test('carry no unrendered Markdown syntax', () => {
    const dirty = manifest()
      .pages.flatMap(page => page.headings.map(heading => ({ page: page.id, ...heading })))
      .filter(heading => /\*|`|\]\(/.test(heading.path));
    assert.deepEqual(
      dirty.slice(0, 5).map(h => `${h.page}: ${h.path}`),
      [],
      'heading paths still contain Markdown syntax',
    );
  });

  test('anchor at a heading that exists in the rendered page', () => {
    /* A sample rather than the corpus: this reads one HTML file per page and
       the assertion is about a rule, not about coverage. */
    let checked = 0;
    const missing = [];
    for (const page of manifest().pages.slice(0, 40)) {
      const file = path.join(DIST, page.id, 'index.html');
      if (!existsSync(file)) continue;
      const html = readFileSync(file, 'utf8');
      for (const heading of page.headings) {
        checked += 1;
        if (!html.includes(`id="${heading.anchor}"`)) missing.push(`${page.id}#${heading.anchor}`);
      }
    }
    assert.ok(checked > 0, 'no heading was checked — the sample found no pages');
    assert.deepEqual(missing.slice(0, 5), [], 'manifest anchors point at ids the page does not have');
  });

  test('a heading repeated on one page gets distinct anchors', t => {
    const page = manifest().pages.find(entry => {
      const paths = entry.headings.map(heading => heading.path);
      return new Set(paths).size < paths.length;
    });
    /* Not every corpus repeats a heading path within one page. */
    if (!page) return t.skip('no page repeats a heading');
    const repeated = page.headings.filter(
      (heading, index, all) => all.findIndex(other => other.path === heading.path) !== index,
    );
    for (const heading of repeated) {
      const twins = page.headings.filter(other => other.path === heading.path);
      assert.equal(
        new Set(twins.map(other => other.anchor)).size,
        twins.length,
        `${page.id} gives the same anchor to two headings named "${heading.path}"`,
      );
    }
  });
});

describe('the Markdown twin says each thing once', () => {
  const anyPage = () => {
    const id = JSON.parse(readFileSync(path.join(DIST, 'agent-manifest.json'), 'utf8')).pages[0].id;
    return readFileSync(path.join(DIST, `${id}.md`), 'utf8');
  };

  test('the frontmatter is not echoed in the body', () => {
    const markdown = anyPage();
    const [, header, body] = markdown.split('---\n', 3);
    const description = header.match(/^description: "(.*)"$/m)?.[1];
    const canonical = header.match(/^canonical: "(.*)"$/m)?.[1];

    assert.ok(canonical, 'the standalone twin carries no canonical URL');

    /*
     * The echo this guards against was a `Source: <url>` line under the
     * heading, so that is what to look for. A substring search for the
     * canonical itself was the first attempt and it only ever passed by
     * accident: the homepage's canonical is the bare origin, which is a prefix
     * of every absolute link to this site, so any page that curls its own URL
     * in an example tripped it — but only once SITE_URL named the same host the
     * prose does. Built with the placeholder origin, the two never collided and
     * the assertion looked sound. llms-full.txt keeps its `Source:` lines on
     * purpose; the test below covers that side.
     */
    assert.doesNotMatch(body, /^Source:\s/m, 'the URL is repeated as a Source: line in the body');
    if (description && description.length > 20) {
      assert.ok(
        !body.split('\n').slice(0, 4).join('\n').includes(description),
        'the description is repeated as the opening paragraph',
      );
    }
  });

  test('llms-full.txt still names every page it contains', () => {
    /* The header is off there, so `Source:` is the only URL carrier. Dropping
       it as "redundant" would strip every URL from the full-corpus dump. */
    const sources = (outputs.llmsFull.match(/^Source: https?:\/\//gm) ?? []).length;
    /* Counted against the manifest rather than against `# ` headings in the
       text: shell and YAML blocks are full of `# comment` lines at line start,
       which inflate a heading count by a quarter. Both the manifest and
       llms-full.txt exclude drafts and noindex pages, so the two agree. */
    const published = JSON.parse(
      readFileSync(path.join(DIST, 'agent-manifest.json'), 'utf8'),
    ).pages.length;
    assert.ok(sources > 0, 'llms-full.txt carries no page URLs at all');
    assert.equal(sources, published, 'not every page in llms-full.txt carries its URL');
  });
});

/**
 * A source-level guard, not a dist-level one — on purpose.
 *
 * `site.basePath` is `''` in every distribution this engine ships, and at an
 * empty prefix a hand-authored `/mcp` and a correctly built `withBase('/mcp')`
 * produce the identical byte in `dist/`. A test that only reads the build
 * output is structurally blind to this class of bug: it would need a *second*
 * build under a non-empty `basePath` to ever fail, and nothing here runs one.
 *
 * That is exactly how six cross-references — llms.txt's `## Optional` block,
 * robots.txt's copy-paste footer, the page `<head>`'s favicon and service-desc
 * links, the sitemap's stylesheet, and the generated OpenAPI document's own
 * `servers` entry — went unprefixed for a while despite `hrefFor` already
 * solving the equivalent problem for every content page. They are not content
 * pages, so `hrefFor` never saw them; each is a literal string typed once,
 * elsewhere. Confirmed by building under `basePath: '/docs'` by hand and
 * reading the result, which is not something to keep doing by hand.
 *
 * So this reads the source directly and asserts the invariant that actually
 * matters: every occurrence of one of these literals is wrapped in
 * `withBase(…)`, regardless of what `basePath` happens to be today.
 */
describe('framework-level links go through withBase', () => {
  const checks = [
    { file: 'src/pages/llms.txt.ts', tokens: ["'/llms-full.txt'", "'/mcp'", "'/api/docs'", "'/api/docs/openapi.json'", "'/sitemap.xml'", "'/updates.xml'", 'OPENAPI_PATH'] },
    { file: 'src/pages/robots.txt.ts', tokens: ["'/sitemap.xml'", "'/llms.txt'", "'/llms-full.txt'", "'/updates.xml'", "'/mcp'", "'/api/docs'", 'OPENAPI_PATH'] },
    { file: 'src/components/DocumentHead.astro', tokens: ["'/favicon.svg'", "'/llms.txt'", "'/sitemap.xml'", "'/updates.xml'", 'seo.defaultImage', 'OPENAPI_PATH'] },
    { file: 'src/pages/sitemap.xml.ts', tokens: ["'/sitemap.xsl'"] },
    /* The feed's own self-URL, and the generated share cards. Both escaped this
       list once: the feed's <link rel="self"> named the origin's /updates.xml,
       and every og:image pointed at an unprefixed /og/… no request would reach. */
    { file: 'src/pages/updates.xml.ts', tokens: ["'/updates.xml'"] },
    { file: 'src/pages/[...slug].astro', tokens: ["'/og.png'", '`/og/'] },
  ];

  for (const { file, tokens } of checks) {
    test(`${file}`, () => {
      /* Import lines legitimately mention a bare identifier like OPENAPI_PATH
         without wrapping it — they are declaring the name, not using it as a
         path. Everywhere else in these files is a use site. */
      const body = readFileSync(path.join(ROOT, file), 'utf8')
        .split('\n')
        .filter(line => !/^\s*import /.test(line))
        .join('\n');

      for (const token of tokens) {
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const total = (body.match(new RegExp(escaped, 'g')) ?? []).length;
        const wrapped = (body.match(new RegExp(`withBase\\(\\s*${escaped}`, 'g')) ?? []).length;
        assert.equal(
          wrapped,
          total,
          `${file}: ${token} appears ${total} time(s) outside an import, but only ${wrapped} go through withBase()`,
        );
      }
    });
  }

  /* The WebMCP bridge is the one case that cannot be spelled withBase(…).
     `src/lib/webmcp.ts` imports nothing on purpose — that is what lets a test
     load it under Node's type stripping — so it takes the base as an argument
     and the component supplies it. Both call sites need it: the endpoints were
     bare absolute paths for longer than anything else here, because the bridge
     runs only in a browser with the WebMCP API and no test has one. A fork
     deployed under /docs registered zero tools, silently, until someone read
     its live HTML. */
  test('src/components/WebMcpBridge.astro passes the base path to the bridge', () => {
    const source = readFileSync(path.join(ROOT, 'src', 'components', 'WebMcpBridge.astro'), 'utf8');
    assert.match(
      source,
      /loadTools\(\s*site\.basePath\s*\)/,
      'loadTools() is called without site.basePath, so a subpath deployment registers no tools',
    );
    assert.match(
      source,
      /callTool\(\s*tool\.name\s*,\s*args\s*,\s*site\.basePath\s*\)/,
      'callTool() is called without site.basePath, so a subpath deployment cannot invoke a tool',
    );
  });

  test('src/lib/structured-data.ts wraps the organisation logo', () => {
    const source = readFileSync(path.join(ROOT, 'src', 'lib', 'structured-data.ts'), 'utf8');
    assert.match(
      source,
      /withBase\(\s*seo\.organization\.logo/,
      'the organisation logo is read without withBase(), so it will 404 under a subpath deployment',
    );
  });
});

/*
 * Unit-level for the same reason the withBase guard is source-level: every H2
 * in content/ is currently unique within its page, so a dist-level assertion
 * over search-index.json is structurally blind to the duplicate case. The
 * manifest's outline() hit this exact bug and got an occurrence counter;
 * these pin the search index to the same scheme so the two cannot diverge
 * again the day a page legitimately repeats a heading.
 */
describe('search sections keep their anchors', () => {
  test('a repeated H2 deep-links each occurrence to its own anchor', () => {
    const body = [
      '## Update the DNS',
      'For the domain.',
      '## Update the DNS',
      'For the subdomain.',
    ].join('\n');
    /* What Astro's renderer hands over: one slug per occurrence, in order. */
    const headings = [
      { depth: 2, slug: 'update-the-dns', text: 'Update the DNS' },
      { depth: 2, slug: 'update-the-dns-1', text: 'Update the DNS' },
    ];
    assert.deepEqual(
      toSections(body, headings).map(section => section.a),
      ['update-the-dns', 'update-the-dns-1'],
      'the second occurrence of a repeated heading must keep its own anchor, not inherit the first',
    );
  });

  test('a decorated H2 still finds the slug of its rendered text', () => {
    /* A link and inline code in the heading: the slug map is keyed by the
       *rendered* text, so the source line has to reduce to exactly that. */
    const body = ['## [Serving `list_pages`](https://example.com)', 'Prose.'].join('\n');
    const headings = [{ depth: 2, slug: 'serving-list_pages', text: 'Serving list_pages' }];
    const [section] = toSections(body, headings);
    assert.equal(section.h, 'Serving list_pages');
    assert.equal(section.a, 'serving-list_pages', 'a decorated heading missed the slug lookup and lost its anchor');
  });
});
