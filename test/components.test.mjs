import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { cssColor, cssCounter, cssCustomProperties } from '../src/lib/css-value.ts';
import { rehypeInlineLinks } from '../src/lib/rehype-inline-links.ts';
import { slugify } from '../src/lib/slug.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const distDir = path.join(ROOT, 'dist');
/* The page that renders the whole component vocabulary, and therefore the one
   worth asserting against: if a primitive stops emitting what the interface
   scripts look for, it breaks here first. Point these at your own gallery if you
   replace this site's content — the tests skip cleanly when the page is absent
   rather than failing a site that has no such page. */
const htmlPath = path.join(ROOT, 'dist', 'reference', 'components', 'index.html');
const markdownPath = path.join(ROOT, 'dist', 'reference', 'components.md');

const sourceFiles = (dir = SRC) =>
  readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const next = path.join(dir, item.name);
    if (item.isDirectory()) return sourceFiles(next);
    return /\.(astro|ts)$/.test(item.name) ? [next] : [];
  });

const relative = file => path.relative(ROOT, file);

/*
 * The unit tests below cover the logic that has no markup: what a component
 * accepts, and what it refuses. The build-output tests after them cover what
 * only exists once Astro has run. Both matter — a sanitiser that is correct in
 * isolation is still worthless if no component calls it, which is what the
 * source guards at the end check.
 */

describe('css-value: what a page is allowed to put in a style attribute', () => {
  test('accepts every notation a colour is legitimately written in', () => {
    for (const value of [
      '#fff',
      '#8b5cf6',
      '#8b5cf680',
      'rebeccapurple',
      'rgb(139 92 246 / 0.5)',
      'hsl(258, 90%, 66%)',
      'oklch(62% 0.21 292)',
      'var(--accent)',
      'color-mix(in srgb, var(--accent) 40%, transparent)',
    ]) {
      assert.equal(cssColor(value), value, `${value} should be accepted`);
    }
  });

  test('refuses a value that could become a second declaration', () => {
    /* The whole point: a `;` ends the colour and starts a property the author
       never wrote, and everything after it applies to the same element. */
    assert.equal(cssColor('red;position:fixed;inset:0'), undefined);
    assert.equal(cssColor('red;background:black'), undefined);
  });

  test('refuses a value that would fetch from another server', () => {
    assert.equal(cssColor('url(https://example.test/pixel.png)'), undefined);
    assert.equal(cssColor('URL ( https://example.test )'), undefined);
  });

  test('refuses markup, quotes and anything that is not a string', () => {
    assert.equal(cssColor('"><script>alert(1)</script>'), undefined);
    assert.equal(cssColor("red'"), undefined);
    assert.equal(cssColor(''), undefined);
    assert.equal(cssColor('   '), undefined);
    assert.equal(cssColor(undefined), undefined);
    assert.equal(cssColor(42), undefined);
    assert.equal(cssColor('#' + 'a'.repeat(120)), undefined, 'an absurd length is not a colour');
  });

  test('trims, so an author\'s stray whitespace is not a rejection', () => {
    assert.equal(cssColor('  #8b5cf6 '), '#8b5cf6');
  });

  test('cssCounter quotes an integer and drops everything else', () => {
    assert.equal(cssCounter(5), "'5'");
    assert.equal(cssCounter('7'), "'7'");
    assert.equal(cssCounter(3.9), "'3'");
    assert.equal(cssCounter(undefined), undefined);
    assert.equal(cssCounter(''), undefined);
    /* A step number is `content:`, so an unquoted injection here would be read
       as CSS rather than as text. */
    assert.equal(cssCounter("1'; color: red; content: '"), undefined);
    assert.equal(cssCounter('not a number'), undefined);
  });

  test('cssCustomProperties keeps only well-formed custom properties', () => {
    assert.equal(
      cssCustomProperties({ '--tree-highlight': '#8b5cf6' }),
      '--tree-highlight:#8b5cf6',
    );
    assert.equal(
      cssCustomProperties('--tree-highlight: #8b5cf6'),
      '--tree-highlight:#8b5cf6',
    );
    /* A real property is not a custom property: only `--x` may be set this way,
       so a component's style prop can never move or hide an element. */
    assert.equal(cssCustomProperties({ position: 'fixed' }), undefined);
    assert.equal(cssCustomProperties({ '--x': 'url(https://example.test)' }), undefined);
    assert.equal(cssCustomProperties(undefined), undefined);
    assert.equal(cssCustomProperties({}), undefined);
  });
});

describe('slugify: a label that has to survive becoming an anchor', () => {
  test('turns a date written for a reader into a usable fragment', () => {
    assert.equal(slugify('August 3, 2026'), 'august-3-2026');
    assert.equal(slugify('2026-08-03'), '2026-08-03');
  });

  test('drops punctuation and collapses whitespace', () => {
    assert.equal(slugify('Guard metrics: what changed?'), 'guard-metrics-what-changed');
    assert.equal(slugify('  spaced   out  '), 'spaced-out');
  });

  test('keeps letters outside ASCII', () => {
    assert.equal(slugify('Évaluation à froid'), 'évaluation-à-froid');
  });
});

/* ── The built site ──────────────────────────────────────────────────────── */

describe('component authoring contract', () => {
  test('the gallery exercises the rich component primitives', t => {
    if (!existsSync(htmlPath)) return t.skip('this distribution has no component gallery');
    const html = readFileSync(htmlPath, 'utf8');
    for (const marker of [
      'badge-stroke',
      'color-table-row',
      'data-content-view',
      'data-mermaid-actions="true"',
      'data-right-rail-content',
      'data-tab-sync',
    ]) {
      assert.ok(html.includes(marker), `component gallery does not render ${marker}`);
    }
  });

  test('Visibility serves opposite content to people and agents', t => {
    if (!existsSync(markdownPath)) return t.skip('this distribution has no component gallery');
    const html = readFileSync(htmlPath, 'utf8');
    const markdown = readFileSync(markdownPath, 'utf8');
    /* The two halves of the <Visibility> pair on that page. They are ordinary
       prose rather than a fixture string, so the assertion tracks what a reader
       actually gets — but it does mean rewording that passage means reworking
       this line. */
    const human = 'You are reading the rendered page';
    const agent = 'You are reading the Markdown twin';

    assert.ok(html.includes(human), 'human-only content is absent from HTML');
    assert.ok(!html.includes(agent), 'agent-only content leaked into HTML');
    assert.ok(!markdown.includes(human), 'human-only content leaked into Markdown');
    assert.ok(markdown.includes(agent), 'agent-only content is absent from Markdown');
  });

  test('member-expression aliases leave clean Markdown', t => {
    if (!existsSync(markdownPath)) return t.skip('this distribution has no component gallery');
    const markdown = readFileSync(markdownPath, 'utf8');
    assert.ok(markdown.includes('`app/`'), 'Tree.Folder did not become a Markdown folder');
    assert.ok(markdown.includes('**Accent**'), 'Color.Item did not become a Markdown colour entry');

    /* Leakage means a tag that survived rendering. A tag *named* in prose —
       ``<Color.Item>`` in a sentence describing it — is the opposite: it is a
       page documenting the component, which is exactly what this page does. Strip
       code spans and fences first, or the reference page can never mention the
       thing it references. */
    const prose = markdown
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`\n]*`/g, '');
    assert.doesNotMatch(prose, /<(?:Color|Tree)\./, 'component member syntax leaked into Markdown');
    assert.doesNotMatch(prose, /<(?:View|Panel|Mermaid)\b/, 'a component tag leaked into Markdown');
  });

  test('a changelog label is linkable however it is written', t => {
    if (!existsSync(htmlPath)) return t.skip('this distribution has no component gallery');
    const html = readFileSync(htmlPath, 'utf8');
    /* The label reads "August 3, 2026"; the anchor has to be a fragment, or the
       permalink beside every entry points at nothing. */
    assert.ok(
      html.includes('id="august-3-2026"') && html.includes('href="#august-3-2026"'),
      'an <Update> label was used verbatim as an id instead of being slugified',
    );
  });
});

describe('the site-wide banner', () => {
  /* Any built page carries the shell, so this asserts the banner's geometry
     rather than anything about the page it reads. */
  const anyPage = htmlPath;

  test('reserves the space it occupies through one token', t => {
    if (!existsSync(anyPage)) return t.skip('nothing built');
    const html = readFileSync(anyPage, 'utf8');
    const configured = html.includes('data-global-banner');
    if (!configured) return t.skip('this distribution configures no banner');

    /* The flag has to be on <html>: `scroll-padding-top` is set there, and a
       flag on <body> is invisible to it. */
    assert.match(html, /<html[^>]*data-has-global-banner/, 'the banner flag is not on the root element');
  });

  test('every displaced offset is derived, not written out', () => {
    const tokens = readFileSync(path.join(SRC, 'styles', 'tokens.css'), 'utf8');
    const shell = readFileSync(path.join(SRC, 'styles', 'shell.css'), 'utf8');

    assert.match(tokens, /--banner-h:\s*0px/, 'the banner height token has no zero default');
    assert.match(tokens, /:root\[data-has-global-banner\][^}]*--banner-h:\s*var\(--banner-min\)/s);

    /* The strip's floor and the space the shell reserves must be two tokens.
       One token means the measured height can never fall below the floor it
       itself sets, which is how a wrapped banner stayed tall after the window
       widened again. */
    assert.match(shell, /\.global-banner\s*\{[^}]*min-height:\s*var\(--banner-min\)/s,
      'the strip takes its floor from --banner-h, which cannot shrink once measured');
    assert.doesNotMatch(shell, /\.global-banner\s*\{[^}]*min-height:\s*var\(--banner-h\)/s);

    /* Each of these is a place the strip pushes something down. They live in
       three media queries, which is exactly why they are asserted together:
       fixing them one at a time is how half of them stayed unfixed. */
    for (const rule of [
      /scroll-padding-top:\s*calc\(var\(--shell-top\)/,
      /\.topbar\s*\{[^}]*inset:\s*var\(--banner-h\)/s,
      /\.categorybar\s*\{[^}]*top:\s*calc\(var\(--banner-h\)/s,
      /\.mobile-pagebar\s*\{[^}]*top:\s*calc\(var\(--banner-h\)/s,
      /padding-top:\s*calc\(var\(--banner-h\)\s*\+\s*var\(--header\)\s*\+\s*var\(--mobile-pagebar\)\)/,
      /unified-sidebar'\]\s*\{\s*--shell-top:\s*calc\(var\(--banner-h\)/s,
    ]) {
      assert.match(shell, rule, `a fixed offset does not account for --banner-h: ${rule}`);
    }
    assert.match(
      tokens,
      /--shell-top:\s*calc\(var\(--banner-h\)/,
      'the shared shell offset does not account for --banner-h',
    );
  });
});

/*
 * Guards, not assertions about behaviour: each of these is a mistake that was
 * made once, is invisible in review, and is one grep away from never recurring.
 */
describe('source guards', () => {
  test('every _redirects rule points at something the build produced', () => {
    /*
     * The companion to the `_headers` guard below, for the file whose failure is
     * louder and no more visible from here.
     *
     * `_redirects` exists so that a restructure does not break a published URL.
     * A rule whose target has since been renamed keeps redirecting — to a 404,
     * which is strictly worse than the 404 the rule was added to prevent: the
     * old URL now reports a permanent move to a page that is not there, and
     * `curl` on the old path returns 301 and looks healthy. Nothing in the build
     * output, and nothing in Cloudflare, mentions it.
     *
     * Only local targets are judged. An off-site destination cannot be checked
     * against `dist/`, and a rule with a `:placeholder` or a `*` in it is a
     * pattern rather than a path — both are skipped rather than guessed at.
     */
    if (!existsSync(distDir)) return;

    /* Stripped from every target before it is looked up, because the two sides
       disagree about it on a subpath deployment. `_redirects` is evaluated by
       Cloudflare against the incoming request, so its paths carry `basePath`,
       while `dist/` is written without it — the same asymmetry the Worker
       handles by stripping the prefix before `ASSETS.fetch()`. Without this the
       guard would report every rule of a site served under a subpath as broken,
       which is worse than not having it: a fork's first CI run would fail on
       correct configuration. */
    const basePath = (readFileSync(path.join(SRC, 'docs.config.ts'), 'utf8')
      .match(/export const basePath = '([^']*)'/) ?? [, ''])[1];

    const rules = readFileSync(path.join(ROOT, 'public', '_redirects'), 'utf8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(line => line.split(/\s+/))
      .filter(([from, to]) => from && to);

    /* Astro builds in directory format with `trailingSlash: 'never'`, so a page
       target is a directory holding index.html, while /sitemap.xml and friends
       are files. Accept either, and let a bare extension answer for itself. */
    const built = target => {
      const withoutBase =
        basePath && target.startsWith(`${basePath}/`) ? target.slice(basePath.length) : target;
      const relative = withoutBase.replace(/^\//, '');
      if (!relative) return true;
      return (
        existsSync(path.join(distDir, relative, 'index.html')) ||
        existsSync(path.join(distDir, `${relative}.html`)) ||
        existsSync(path.join(distDir, relative))
      );
    };

    const broken = rules
      .filter(([, to]) => to.startsWith('/') && !/[:*]/.test(to))
      .filter(([, to]) => !built(to))
      .map(([from, to]) => `${from} -> ${to}`);

    assert.deepEqual(
      broken,
      [],
      'these _redirects rules send a published URL to a path this build does not ' +
        'contain, so the old link answers 301 and then 404',
    );
  });

  test('every _headers rule matches something the build produced', () => {
    /*
     * A `_headers` rule that matches nothing is invisible. Cloudflare does not
     * warn about it; the asset simply keeps the platform default of
     * `max-age=0, must-revalidate`, and the file still *looks* correct.
     *
     * That is exactly how a sibling site served under `/docs` shipped
     * `/docs/_astro/*` rules. The Worker strips `site.basePath` before calling
     * `ASSETS.fetch()`, so matching happens against the built path — every
     * fingerprinted asset was revalidated on every page view for as long as
     * nobody measured it, while the catch-all `/*` block kept applying and made
     * the file read as though it worked.
     *
     * Checking against `dist/` rather than against the config catches the whole
     * family at once: a basePath prefix, a renamed directory, a typo, a rule
     * kept after the thing it covered was deleted.
     */
    if (!existsSync(distDir)) return; // built by `npm test`; skipped on a bare checkout

    const built = [];
    const walk = dir => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const next = path.join(dir, item.name);
        if (item.isDirectory()) walk(next);
        else built.push(`/${path.relative(distDir, next).split(path.sep).join('/')}`);
      }
    };
    walk(distDir);

    const rules = readFileSync(path.join(ROOT, 'public', '_headers'), 'utf8')
      .split('\n')
      .map(line => line.trim())
      /* A rule is a line starting with `/`; everything else is a comment or an
         indented header. `/*` is the catch-all and matches by definition. */
      .filter(line => line.startsWith('/') && line !== '/*');

    const dead = rules.filter(rule => {
      if (rule.endsWith('/*')) {
        const prefix = rule.slice(0, -1);
        return !built.some(file => file.startsWith(prefix));
      }
      return !built.includes(rule);
    });

    assert.deepEqual(
      dead,
      [],
      'these _headers rules match no built file, so their headers are never sent',
    );
  });

  test('every file the Worker never sees has an explicit cache rule', () => {
    /*
     * The inverse of the guard above, and the mistake that is easier to make:
     * adding a file to `public/`, excluding it from `run_worker_first` so it
     * skips the Worker invocation, and never giving it a `Cache-Control` rule.
     * Nothing fails. The file serves correctly, forever, at Cloudflare's
     * platform default of `max-age=0, must-revalidate` — which is right for a
     * page that changes and silently wrong for an image that does not, and
     * there is no build output, no header, and no test failure to notice it by.
     *
     * This happened twice: `frame-demo.svg` and `sitemap.xsl` had neither rule
     * from the day `run_worker_first` first excluded them, and the images added
     * for the homepage screenshot and its share card repeated it immediately.
     * Both are now covered — this test is what keeps the next one from joining
     * them unnoticed.
     *
     * `_astro/*`, exempt below, is Astro's own fingerprinted bundle: its name
     * changes with its bytes, so `immutable` is correct and already present.
     * `og/*` and `og.png` are the generated per-page cards, also already ruled.
     */
    if (!existsSync(distDir)) return;

    const wranglerConfig = readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8');
    const excluded = [...wranglerConfig.matchAll(/"!(\/[^"]+)"/g)].map(match => match[1]);

    const headerRules = readFileSync(path.join(ROOT, 'public', '_headers'), 'utf8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('/') && line !== '/*');

    const covered = pattern => {
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -1);
        return headerRules.some(
          rule => rule === pattern || (rule.endsWith('/*') && rule.slice(0, -1) === prefix),
        );
      }
      return headerRules.includes(pattern);
    };

    const uncovered = excluded.filter(pattern => !covered(pattern));

    assert.deepEqual(
      uncovered,
      [],
      'these paths skip the Worker but have no _headers rule, so they serve at ' +
        "Cloudflare's max-age=0 default — add a Cache-Control rule for each",
    );
  });

  test('every content image is sized from the file it points at', () => {
    /*
     * `width`/`height` on a content image exist to stop the article jumping as
     * each screenshot arrives, so a *wrong* pair is worse than none: the browser
     * reserves the wrong box and shifts anyway. Two separate bugs produced
     * exactly that, and neither was visible in the markup.
     *
     * The first was path resolution. `src` is a URL and carries `site.basePath`;
     * `public/` is a directory and does not. On a site served under `/docs`, the
     * plugin looked for `public/docs/screenshots/…`, found nothing, and fell
     * through to whatever an image manifest happened to hold. The second was the
     * manifest itself: replace a screenshot without re-running the importer that
     * wrote it and the stale entry wins. A sibling site shipped
     * `width="1265" height="1640"` for an image that is 2398×1490 — a portrait
     * box reserved for a landscape screenshot.
     *
     * Comparing the built HTML against the bytes on disk catches both at once,
     * and anything else that ever comes between the two.
     */
    if (!existsSync(distDir)) return;

    const basePath = (readFileSync(path.join(SRC, 'docs.config.ts'), 'utf8')
      .match(/export const basePath = '([^']*)'/) ?? [, ''])[1];

    const pages = [];
    const walk = dir => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const next = path.join(dir, item.name);
        if (item.isDirectory()) walk(next);
        else if (item.name.endsWith('.html')) pages.push(next);
      }
    };
    walk(distDir);

    /* Dimensions straight out of the file. Only the formats the plugin claims to
       read: anything else legitimately has no intrinsic size to check. */
    const sizeOf = file => {
      const header = readFileSync(file);
      if (header.length > 24 && header.toString('ascii', 1, 4) === 'PNG') {
        return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
      }
      if (header.length > 30 && header.toString('ascii', 0, 4) === 'RIFF'
        && header.toString('ascii', 8, 12) === 'WEBP') {
        const chunk = header.toString('ascii', 12, 16);
        if (chunk === 'VP8X') {
          return { width: header.readUIntLE(24, 3) + 1, height: header.readUIntLE(27, 3) + 1 };
        }
        if (chunk === 'VP8 ') {
          return { width: header.readUInt16LE(26) & 0x3fff, height: header.readUInt16LE(28) & 0x3fff };
        }
        if (chunk === 'VP8L') {
          const bits = header.readUInt32LE(21);
          return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
        }
      }
      return null;
    };

    const checked = new Map();
    const wrong = [];
    for (const page of pages) {
      const html = readFileSync(page, 'utf8');
      const pattern = /<img\b[^>]*?src="([^"]+\.(?:png|webp))"[^>]*?width="(\d+)"[^>]*?height="(\d+)"/gi;
      for (const [, src, width, height] of html.matchAll(pattern)) {
        if (checked.has(src) || !src.startsWith('/')) continue;
        const relative = basePath && src.startsWith(`${basePath}/`) ? src.slice(basePath.length) : src;
        const file = path.join(ROOT, 'public', relative.replace(/^\//, ''));
        if (!existsSync(file)) continue;
        const actual = sizeOf(file);
        checked.set(src, true);
        if (!actual) continue;
        if (actual.width !== Number(width) || actual.height !== Number(height)) {
          wrong.push(`${src}: page says ${width}x${height}, file is ${actual.width}x${actual.height}`);
        }
      }
    }

    assert.deepEqual(
      wrong,
      [],
      'these images are served with dimensions their own file contradicts, so the page shifts',
    );
  });

  test('no content image is wider than the layout can use', async () => {
    /*
     * A screenshot exported from a retina display is around 2400–2900px wide.
     * The reading column is 712px, the browser downscales the rest for free, and
     * nothing looks wrong — so this is a cost that never announces itself. On a
     * sibling site it was 1.3 MB of screenshots delivering roughly 500 KB of
     * detail anyone could see.
     *
     * The cap comes from the script that enforces it rather than being repeated
     * here, so the check and the fix cannot drift apart: whatever
     * `npm run images:optimize` resizes to is what this asserts.
     */
    const { oversized, MAX_WIDTH } = await import('../scripts/optimize-images.mjs');
    const found = await oversized();
    assert.deepEqual(
      found.map(item => `${item.file} (${item.width}x${item.height})`),
      [],
      `these images are wider than ${MAX_WIDTH}px, so readers download detail no screen shows — run \`npm run images:optimize\``,
    );
  });

  test('no component declares a prop nothing reads', () => {
    const offenders = sourceFiles()
      .filter(file => readFileSync(file, 'utf8').includes('iconType'))
      .map(relative);
    assert.deepEqual(offenders, [], 'iconType is accepted by these components and used by none');
  });

  test('every corner radius in the scale comes from the scale', () => {
    /*
     * `theme.radius` in docs.config.ts is advertised as the one place a fork
     * changes its corners, and a hand-written `border-radius: 12px` breaks that
     * promise twice over: it ignores the config today, and it looks correct
     * while doing so, because 12px is what `--r-md` happens to be right now.
     * Twenty-three declarations had drifted that way before this test existed —
     * including an icon button at 10px and sidebar rows at 7px and 9px, three
     * radii no token has ever held.
     *
     * Four notations stay legal. A token. A `calc()` built on one, which is how
     * a shell wraps a control two pixels tighter and still tracks the config.
     * `0`, `50%` and `999px`, which mean "square", "circle" and "pill" — none of
     * them a point on a scale. And a raw value below the smallest token, for the
     * hairline on a `mark` or a `kbd`: the scale bottoms out at 6px, so those
     * are outside its range rather than drifting inside it.
     */
    const floor = 6;
    const offenders = [];
    for (const file of readdirSync(path.join(SRC, 'styles')).filter(name => name.endsWith('.css'))) {
      /* Comments out first: this file's own prose quotes the notations it is
         describing, and a sentence about `border-radius` is not one. */
      const source = readFileSync(path.join(SRC, 'styles', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
      for (const [, value] of source.matchAll(/border-radius:\s*([^;}]+)/gi)) {
        /* Each calc() must be anchored to a token; its own offsets are then
           free, so they are dropped before the raw-value check below. */
        const calcs = [...value.matchAll(/calc\(([^)]*\([^)]*\)[^)]*|[^)]*)\)/g)];
        for (const [, body] of calcs) {
          if (!body.includes('var(--r-')) offenders.push(`${file}: calc(${body})`);
        }
        const bare = calcs
          .reduce((rest, [whole]) => rest.replace(whole, ' '), value)
          .replace(/var\(\s*--r-[a-z]+\s*\)/g, ' ');
        for (const [, px] of bare.matchAll(/(\d+)px/g)) {
          if (Number(px) >= floor && px !== '999') offenders.push(`${file}: ${px}px in "${value.trim()}"`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'these radii are written by hand, so theme.radius no longer controls every corner',
    );
  });

  test('no stylesheet reads a custom property nothing declares', () => {
    /*
     * `var(--x)` with no fallback and no declaration anywhere is not a syntax
     * error — the property is simply unset, so the rule silently does nothing.
     * That is how `--c-border-strong` shipped: one hover state quietly had no
     * border colour, and nothing in the build or the browser said so.
     *
     * Declarations are collected from the stylesheets, from the components that
     * emit inline custom properties, and from the scripts that call
     * setProperty — all three are legitimate places for a token to be born.
     */
    const external = new Set([
      /* Emitted by Shiki onto each highlighted token in the built HTML. */
      '--shiki-light',
      '--shiki-dark',
    ]);

    const stylesheets = readdirSync(path.join(SRC, 'styles'))
      .filter(name => name.endsWith('.css'))
      .map(name => path.join(SRC, 'styles', name));

    const declared = new Set(external);
    for (const file of [...new Set([...stylesheets, ...sourceFiles()])]) {
      const source = readFileSync(file, 'utf8');
      for (const [, name] of source.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(name);
      for (const [, name] of source.matchAll(/setProperty\(\s*['"](--[a-z0-9-]+)/gi)) declared.add(name);
    }

    const undeclared = new Map();
    for (const file of stylesheets) {
      const source = readFileSync(file, 'utf8');
      for (const [, name] of source.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)) {
        if (!declared.has(name)) undeclared.set(name, relative(file));
      }
    }

    assert.deepEqual(
      [...undeclared].map(([name, file]) => `${name} (${file})`),
      [],
      'these custom properties are read but never declared, so the rules using them do nothing',
    );
  });

  test('every language icon URL carries the base path', () => {
    const offenders = sourceFiles()
      .filter(file => !file.endsWith(path.join('lib', 'language-icon.ts')))
      .filter(file => /['"`]\/icons\/languages\//.test(readFileSync(file, 'utf8')))
      .map(relative);
    assert.deepEqual(
      offenders,
      [],
      'a language icon path is written by hand instead of going through languageIconUrl',
    );
  });

  test('every value reaching a style attribute comes from a vetted builder', () => {
    /* The shape this forbids is style={`--x:${somethingAnAuthorWrote}`}. A `;`
       in that value ends the declaration and everything after it is a property
       the author never wrote — applied to that element. Two builders are
       allowed to produce such a string: the sanitisers in lib/css-value.ts, and
       lib/language-icon.ts, whose input is the build's own slug. */
    const vetted = ['css-value', 'language-icon'];
    const offenders = sourceFiles()
      .filter(file => file.endsWith('.astro'))
      .filter(file => {
        const source = readFileSync(file, 'utf8');
        const interpolates = /style=\{[^}]*\$\{/.test(source);
        return interpolates && !vetted.some(builder => source.includes(builder));
      })
      .map(relative);
    assert.deepEqual(offenders, [], 'these components build a style attribute without sanitising it');
  });

  test('the Node version the docs promise is the one the toolchain accepts', () => {
    /*
     * This one shipped. package.json said `>=20`, the workflow installed 20, and
     * README, CONTRIBUTING and getting-started all told the reader "Node 20 or
     * newer" — while Astro's own engines field requires >=22.12.0. Every local
     * build passed, because the machine happened to run 22. The first push to a
     * public repository failed on `astro check`, and the error a new contributor
     * would have seen was Astro's, on a version this project told them to use.
     *
     * Three things have to agree, and none of them can see the others: the floor
     * in package.json, the major in .nvmrc that CI and `nvm use` both read, and
     * the sentence in the prose. This checks all three against the dependency
     * that actually sets the floor.
     */
    const major = spec => Number(String(spec).match(/(\d+)/)?.[1] ?? 0);
    const minor = spec => Number(String(spec).match(/\d+\.(\d+)/)?.[1] ?? 0);

    const declared = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).engines?.node;
    assert.ok(declared, 'package.json declares no engines.node');

    /* The suite itself sets a floor above Astro's: the test files import `.ts`
       sources directly (see test/agents.test.mjs) and rely on Node stripping
       the types, which is unflagged only from 22.18. A floor between Astro's
       22.12 and that would ship the same broken promise described above —
       `npm install && npm run build` works, `npm test` dies loading the
       suite. */
    assert.ok(
      major(declared) > 22 || (major(declared) === 22 && minor(declared) >= 18),
      `package.json allows Node ${declared}, but the test suite needs the type stripping Node enables by default from 22.18`,
    );

    /* Astro's floor, read from the installed dependency rather than restated. */
    const astroPackage = path.join(ROOT, 'node_modules', 'astro', 'package.json');
    if (existsSync(astroPackage)) {
      const required = JSON.parse(readFileSync(astroPackage, 'utf8')).engines?.node;
      if (required) {
        const declaredFloor = [major(declared), minor(declared)];
        const requiredFloor = [major(required), minor(required)];
        assert.ok(
          declaredFloor[0] > requiredFloor[0] ||
            (declaredFloor[0] === requiredFloor[0] && declaredFloor[1] >= requiredFloor[1]),
          `package.json allows Node ${declared} but astro requires ${required}`,
        );
      }
    }

    const nvmrc = path.join(ROOT, '.nvmrc');
    assert.ok(existsSync(nvmrc), '.nvmrc is missing, and the workflow reads the version from it');
    assert.ok(
      major(readFileSync(nvmrc, 'utf8').trim()) >= major(declared),
      `.nvmrc pins Node ${readFileSync(nvmrc, 'utf8').trim()}, below the ${declared} floor`,
    );

    /* And the prose, which is the copy a reader actually acts on. */
    const claims = ['README.md', 'CONTRIBUTING.md', path.join('content', 'getting-started.mdx')];
    const wrong = claims.flatMap(file => {
      const stated = readFileSync(path.join(ROOT, file), 'utf8').match(/Node (\d+)(?:\.(\d+))?/);
      if (!stated) return [];
      const statedFloor = [Number(stated[1]), Number(stated[2] ?? 0)];
      const ok =
        statedFloor[0] > major(declared) ||
        (statedFloor[0] === major(declared) && statedFloor[1] >= minor(declared));
      return ok ? [] : [`${file} says "${stated[0]}"`];
    });

    assert.deepEqual(wrong, [], `these files promise a Node version below the ${declared} floor`);
  });

  test('a CTA with two actions passes them through Fragment, not a wrapping element', () => {
    /*
     * `<CTA>` puts a 10px flex `gap` on `.cta-actions`, between its *direct*
     * children. `slot="actions"` on a `<div>` or a `<span>` still projects into
     * that slot, but the two buttons inside are then children of that wrapper,
     * not of `.cta-actions` — so the gap has nothing to apply between and the
     * buttons render edge to edge. `<Fragment slot="actions">` contributes its
     * children directly with no wrapper in the DOM, which is what the gap
     * actually needs. content/reference/components.mdx documents `Fragment` as
     * the pattern; three other pages had reached for the more familiar `<div>`
     * instead, and shipped touching buttons on every one of them.
     *
     * There is no rendered output to assert against here — dist/ would show
     * the buttons flush against each other, not an error — so this checks the
     * one thing that actually distinguishes the two: what element wraps the
     * actions passed to a CTA with more than one.
     */
    const contentFiles = [];
    const walk = dir => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const next = path.join(dir, item.name);
        if (item.isDirectory()) walk(next);
        else if (item.name.endsWith('.mdx')) contentFiles.push(next);
      }
    };
    walk(path.join(ROOT, 'content'));

    const offenders = contentFiles
      .filter(file => /<(div|span)\s+slot="actions"/.test(readFileSync(file, 'utf8')))
      .map(relative);

    assert.deepEqual(
      offenders,
      [],
      'these pages wrap a CTA\'s actions slot in an element other than Fragment, ' +
        'which defeats the gap between the buttons: use <Fragment slot="actions">',
    );
  });
});

/**
 * A plain Markdown link has to *look* like a link.
 *
 * This shipped broken: `shell.css` styles a prose link through `.article
 * a.inline`, nothing was adding that class, and so every `[text](url)` in the
 * site rendered in body colour with no underline — a link that worked and gave
 * no sign it was one. A full green test run said nothing, because the anchor was
 * correct in every respect the suite checked. Hence both halves below: the
 * plugin's own behaviour, and the invariant it exists to hold in the build.
 */
describe('prose links', () => {
  /** Runs the plugin over a hast fragment and hands back the anchors. */
  const anchors = tree => {
    rehypeInlineLinks()(tree);
    const found = [];
    const walk = node => {
      for (const child of node.children ?? []) {
        if (child.tagName === 'a') found.push(child);
        walk(child);
      }
    };
    walk(tree);
    return found;
  };

  const anchor = properties => ({ type: 'element', tagName: 'a', properties, children: [] });

  test('a bare Markdown link is given the class its styling needs', () => {
    const [link] = anchors({
      type: 'root',
      children: [
        { type: 'element', tagName: 'p', properties: {}, children: [anchor({ href: '/guides' })] },
      ],
    });
    assert.deepEqual(link.properties.className, ['inline']);
  });

  test('an anchor that already carries a class is left as the author wrote it', () => {
    const [link] = anchors({
      type: 'root',
      children: [anchor({ href: '/guides', className: ['button'] })],
    });
    assert.deepEqual(link.properties.className, ['button']);
  });

  test('a footnote marker stays a marker, not underlined prose', () => {
    const [ref, backref] = anchors({
      type: 'root',
      children: [
        anchor({ href: '#user-content-fn-1', dataFootnoteRef: true }),
        anchor({ href: '#user-content-fnref-1', dataFootnoteBackref: true }),
      ],
    });
    assert.equal(ref.properties.className, undefined);
    assert.equal(backref.properties.className, undefined);
  });

  test('every paragraph link in the build carries its styling', t => {
    if (!existsSync(htmlPath)) return t.skip('this distribution has no component gallery');
    const html = readFileSync(htmlPath, 'utf8');
    /* `.article` is the prose container — a <main>, not an <article> element. */
    const article = html.match(/<main class="article"[\s\S]*?<\/main>/)?.[0];
    assert.ok(article, 'the page has no .article container to inspect');

    /* Scoped to <p> on purpose. An anchor in a paragraph came from Markdown link
       syntax and nothing else, so it is the one place where a missing class is
       unambiguously the bug this guards. Anchors elsewhere in the article — the
       page-actions menu, a Card, the footer — are component-owned and styled
       through their parent's selector, with no class of their own to assert on. */
    const links = [...article.matchAll(/<p>([\s\S]*?)<\/p>/g)].flatMap(paragraph => [
      ...paragraph[1].matchAll(/<a\s([^>]*)>/g),
    ]);

    assert.ok(links.length > 0, 'no paragraph on the page links anywhere, which cannot be right');
    const unstyled = links.map(match => match[1]).filter(a => !/class="[^"]*\binline\b/.test(a));
    assert.deepEqual(unstyled, [], 'a prose link is missing .inline, so it renders as plain text');
  });
});
