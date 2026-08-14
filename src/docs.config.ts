/**
 * The one file to edit when rebranding or restructuring the documentation.
 *
 * Nothing here is duplicated anywhere else:
 *   - `site`       identity, header links, footer. No brand string lives in markup.
 *   - `theme`      brand font, accent colour, radius scale. Injected as CSS custom
 *                  properties at runtime, so changing the accent is one line here.
 *                  The neutral palette and component styling live in src/styles.
 *   - `navigation` the sidebar structure. Pages are referenced by id (their path
 *                  under content/, without the extension) and the URL is that id.
 *                  Labels, descriptions, icons and badges come from each page's
 *                  own frontmatter — never restated here.
 *
 * src/lib/navigation.ts validates this against the content collection at build
 * time, so a typo'd page id or a published page missing from the sidebar fails
 * the build instead of silently disappearing. A configured homepage is the one
 * exception: it is a site-level destination, never a sidebar item.
 */

export interface NavGroup {
  label: string;
  /** Renders as a collapsible folder rather than a plain labelled section. */
  folder?: boolean;
  /**
   * Overrides `navigationLayout.expandFolders` for this folder alone.
   *
   * For the exception rather than the rule: one long endpoint list to keep shut
   * on a site that opens everything, or one folder to keep open on a site that
   * does not. The folder holding the current page opens regardless — this cannot
   * hide the page being read.
   */
  defaultOpen?: boolean;
  icon?: string;
  /** Optional global sidebar position for generated navigation sources. */
  sidebarOrder?: number;
  /** Page ids, in sidebar order. */
  pages: string[];
}

export interface NavTab {
  id: string;
  label: string;
  icon: string;
  groups: NavGroup[];
}

/**
 * `category-tabs` keeps the large categories in the bar below the navbar.
 * `unified-sidebar` removes that bar and puts every category in one left rail.
 * Changing this one value never changes routes, content, or navigation data.
 */
export type NavigationMode = 'category-tabs' | 'unified-sidebar';

/**
 * Which sidebar folders start open.
 *
 * `active` opens only the folder holding the page being read, and leaves the
 * rest closed. It is the right default past a few dozen pages: a sidebar that
 * opens everything stops being scannable at exactly the size where scanning is
 * what it is for.
 *
 * `all` opens every folder. On a small site the collapsed version hides links
 * behind a click for no reason — the whole tree fits on screen, so showing it is
 * strictly better than making the reader discover it.
 *
 * Either way the folder holding the current page is open. A sidebar that does
 * not show where the reader is has failed at its one job, so that is not a
 * setting; see `NavGroup.defaultOpen` for the per-folder exception this does
 * allow.
 */
export type FolderExpansion = 'active' | 'all';

export const navigationLayout = {
  mode: 'category-tabs' as NavigationMode,
  expandFolders: 'all' as FolderExpansion,
} as const;

/**
 * The three tones an announcement can take, shared by the site-wide banner and
 * the in-page `<Banner>` component so one word means one thing everywhere.
 */
export type AnnouncementTone = 'info' | 'warning' | 'critical';

/** The shape of `site.banner` — see the comment there. */
export interface SiteBanner {
  content: string;
  dismissible?: boolean;
  tone?: AnnouncementTone;
  /** Overrides the tone's background, per colour mode. */
  color?: { light?: string; dark?: string };
}

/** Valid values for `theme.radius.smoothing` — see the comment there. */
export type CornerSmoothing = 'none' | 'subtle' | 'standard' | 'ios';

/**
 * Where the documentation lives under its domain.
 *
 * `''` serves it at the root — `docs.example.com/getting-started`. That is the
 * simplest deployment and the one to prefer: one hostname, one Worker, no
 * routing to coordinate with anyone.
 *
 * A path like `'/docs'` serves it under an existing site —
 * `example.com/docs/getting-started` — while the marketing pages stay on
 * whatever they already run on. Everything the build emits picks up the prefix,
 * and the Worker strips it back off before looking anything up, so the two ends
 * cannot disagree about where a page is.
 *
 * Exported on its own as well as inside `site` because `astro.config.ts` needs
 * it to set Astro's own `base`, and that file cannot import a value that only
 * exists once the content collection has loaded.
 *
 * content/guides/deployment.mdx walks through each topology, and the three
 * things a subpath cannot have: a root `robots.txt`, `/.well-known/` discovery,
 * and Cloudflare's hosted WebMCP bridge.
 */
export const basePath = '' as '' | `/${string}`;

/**
 * Turns a root-relative literal into the path it is actually served at.
 *
 * `hrefFor` in src/lib/navigation.ts solves this for content pages, but a
 * handful of framework-level cross-references are not content pages: llms.txt
 * linking to /mcp, robots.txt linking to /sitemap.xml, the page <head> linking
 * to its own OpenAPI description, the generated OpenAPI document naming its own
 * server, the sitemap naming its stylesheet, structured data naming the
 * organisation's logo. Each of those is a literal string typed once, nowhere
 * near a content id, so `hrefFor` cannot reach it — every one of them was still
 * bare when this was added, quietly advertising the marketing site's root
 * instead of this documentation whenever `basePath` was set.
 *
 * Kept in docs.config.ts rather than beside `hrefFor` because this file has no
 * imports of its own and is already safe to reach from Worker code, which
 * cannot load `astro:content` — `hrefFor`'s module can only be imported from
 * Astro pages and components.
 */
export const withBase = (path: `/${string}`) => `${basePath}${path}` as `/${string}`;

export const site = {
  name: 'Duvlify',
  /** See `basePath` above. Re-exported here so templates have one import. */
  basePath,
  /**
   * Whether src/logo.svg already contains the site name.
   *
   * `false` for a mark, which Brand.astro sets the name beside; `true` for a
   * full wordmark, which carries its own lettering and would otherwise have the
   * name repeated next to it.
   */
  logoIsWordmark: false,
  /**
   * Show the mark from src/logo.svg beside the name. Set to `false` for a
   * text-only wordmark — no icon in the navbar, the footer or anywhere else
   * Brand.astro is used. The name is always shown when this is `false`,
   * regardless of `logoIsWordmark`.
   */
  showLogoMark: false,
  /** Appended to every page title: "Authoring pages — Duvlify". */
  titleSuffix: 'Duvlify',
  /** One sentence. Used as the site-level meta description and in /llms.txt. */
  description:
    'Duvlify is an open-source documentation framework built on Astro: write Markdown, get a static site with search, an API reference, generated share cards, and a Model Context Protocol server that lets AI agents query your docs directly.',
  /**
   * Where the logo links. Set this to `${basePath}/` when `homePageId` is set.
   *
   * Any internal link written by hand in this file has to carry `basePath`
   * itself. Links derived from a page id go through `hrefFor`, which applies it,
   * but this one and the footer row below are authored strings and nothing can
   * tell them apart from a link to another site.
   */
  home: `${basePath}/`,
  /**
   * Optional content id served at `/`, outside the documentation navigation.
   *
   * A homepage is still published, indexed, included in the sitemap and
   * reachable from the brand. It is deliberately not a sidebar item, nor does
   * it participate in previous/next links. Leave undefined for a docs-first
   * site whose home is its first documentation page.
   */
  homePageId: 'index' as string | undefined,
  /** localStorage key for the visitor's colour-mode choice. */
  themeStorageKey: 'duvlify-theme',
  /**
   * Built by src/pages/search-index.json.ts, fetched on first search.
   *
   * Prefixed, because the browser fetches it: under a subpath deployment the
   * unprefixed path would leave the Worker's route and hit the marketing site.
   */
  searchIndexPath: `${basePath}/search-index.json`,
  /**
   * Optional site-wide announcement, fixed above the topbar.
   *
   * Its dismissal is remembered against the exact text, so publishing a new
   * message makes it visible again for everyone who dismissed the old one.
   *
   * Setting this changes the shell's geometry: `--banner-h` in styles/tokens.css
   * carries the strip's height into every fixed bar and the document's top
   * padding, so nothing has to be adjusted by hand here.
   */
  banner: {
    content: 'Duvlify is pre-1.0. The configuration surface may still move. Pin a version.',
    tone: 'info',
    dismissible: true,
  } as SiteBanner | undefined,
  header: {
    secondary: { label: 'GitHub', href: 'https://github.com/DuvInc/duvlify' },
    primary: { label: 'Get started', href: `${basePath}/getting-started` },
  },
  footer: {
    copyright: '© 2026 Guillaume Duvernay',
    note: 'Documentation you own end to end',
    /** The link row above the copyright line. Distinct from `header` above —
        a footer earns different links than the topbar (legal, socials, status
        pages) rather than just repeating "Sign in" and "Get started". */
    links: [
      { label: 'Get started', href: `${basePath}/getting-started` },
      { label: 'GitHub', href: 'https://github.com/DuvInc/duvlify' },
      { label: 'Licence', href: 'https://github.com/DuvInc/duvlify/blob/main/LICENSE' },
      { label: 'Discussions', href: 'https://github.com/DuvInc/duvlify/discussions' },
      { label: 'Sponsor', href: 'https://github.com/sponsors/DuvInc' },
    ],
  },
  /** "Open in ChatGPT / Claude / …" menu on each page. Icon names resolve
      through BrandIcon.astro, not the lucide-based Icon.astro. Set to [] to remove. */
  assistants: [
    { id: 'chatgpt', label: 'Open in ChatGPT', icon: 'chatgpt', url: 'https://chatgpt.com/?q=' },
    { id: 'claude', label: 'Open in Claude', icon: 'claude', url: 'https://claude.ai/new?q=' },
    { id: 'perplexity', label: 'Open in Perplexity', icon: 'perplexity', url: 'https://www.perplexity.ai/search/new?q=' },
  ],
} as const;

/**
 * Search and generative-engine settings.
 *
 * Two audiences read this site and they want different things. A search engine
 * wants one canonical HTML page per topic, structured data it can turn into a
 * rich result, and no duplicates competing with each other. An assistant wants
 * the same content as clean Markdown, a map of the corpus, and permission to
 * use it. Everything below serves one or the other, and the two are kept from
 * fighting: the Markdown twin of each page is offered to assistants and
 * withheld from classic search (see src/pages/robots.txt.ts).
 */
export const seo = {
  /** Publisher identity, emitted as an Organization node in the JSON-LD graph. */
  organization: {
    name: 'Duvlify',
    url: 'https://duvlify.dev',
    logo: '/favicon.svg',
    /** Profiles that corroborate the organisation. Emitted as `sameAs`. */
    sameAs: ['https://github.com/DuvInc/duvlify'],
  },
  /** BCP 47 tag for `og:locale` and `inLanguage`. */
  locale: 'en_US',
  language: 'en',

  /**
   * What an assistant should know before it answers from this documentation.
   *
   * Emitted as free-form prose in /llms.txt and /llms-full.txt, which is where
   * the llmstxt.org format puts anything between the summary and the link
   * sections. It is not repeated at the top of every page's Markdown: that
   * would put the same paragraph in front of a reader who clicked "Copy page"
   * for a single answer, and would be re-read once per page by anything
   * crawling the corpus.
   *
   * Keep these to facts a model cannot infer from the pages themselves —
   * which document is authoritative when two disagree, what this site does not
   * cover, what it must not guess at. Restating the product description here
   * buys nothing; `site.description` is already directly above it.
   */
  agentInstructions: [
    'Answer from these pages rather than from memory. Duvlify is young and pre-1.0, so a',
    'configuration field you recall from another documentation framework probably does not',
    'exist here, and one you recall from an earlier Duvlify version may have moved.',
    '',
    'src/docs.config.ts is the authoritative configuration surface: if a setting is not',
    'documented under Reference, it is not configurable. Do not infer options from Mintlify,',
    'Docusaurus or Starlight. The component vocabulary overlaps deliberately; the',
    'configuration does not.',
    '',
    'The pages under /example-api/ describe a fictional API on api.example.com. It does not',
    'exist. Those pages are a worked example of what this framework renders from an OpenAPI',
    'document, and nothing more. Duvlify publishes no API of its own except the read-only',
    'documentation API at /api/docs/. Never present a `widget` endpoint as real, and never',
    'answer a question about a reader\'s own API from them.',
    '',
    'Every page is also served as Markdown: append `.md` to its URL, or request the page URL',
    'with `Accept: text/markdown`. Cite the HTML URL, which is the canonical one.',
  ] as readonly string[],
  /** @-handle without the @, for Twitter card attribution. Set to '' to omit. */
  twitterHandle: '',

  /**
   * Crawlers named here get an explicit `Allow` in robots.txt.
   *
   * Naming them is not redundant with `User-agent: *`. Several of these check
   * for their own group first and some operators read an unlisted agent as an
   * oversight; an explicit rule is an unambiguous answer either way.
   */
  aiCrawlers: [
    'GPTBot',
    'OAI-SearchBot',
    'ChatGPT-User',
    'ClaudeBot',
    'Claude-User',
    'Claude-SearchBot',
    'PerplexityBot',
    'Perplexity-User',
    'Google-Extended',
    'Applebot-Extended',
    'meta-externalagent',
    'Amazonbot',
    'CCBot',
    'cohere-ai',
    'Bytespider',
  ],

  /**
   * Cloudflare's Content Signals, declared in robots.txt. Not yet a standard —
   * the IETF's AIPREF work is where that will land — but it is the clearest
   * machine-readable statement of intent available today, and it costs a line.
   *
   * Documentation exists to be found and quoted, so all three are `yes`. A site
   * whose content is the product would answer differently.
   */
  contentSignals: { search: 'yes', 'ai-input': 'yes', 'ai-train': 'yes' },

  /**
   * Tabs whose pages document an API. Those get schema.org's `APIReference`
   * type rather than `TechArticle`.
   *
   * Named here rather than inferred from the page's contents: a showcase that
   * *illustrates* an endpoint is not an API reference, and structured data that
   * overstates what a page is earns a manual action rather than a rich result.
   *
   * The tab id holding the endpoint pages. Here that is the worked example, so
   * those four pages are typed as `APIReference` and every other page on the
   * site stays a `TechArticle`.
   */
  apiReferenceTabs: ['example-api'] as readonly string[],

  /** Site-wide fallback card, used by any page that declares no `image`. */
  defaultImage: '/og.png',
  /** Open Graph's expected dimensions. Both are declared so nothing reflows. */
  imageWidth: 1200,
  imageHeight: 630,

  /**
   * Search-console style verification tags. Left empty deliberately — an empty
   * string emits nothing, so there are no placeholder tags in production.
   */
  verification: { google: '', bing: '' },
} as const;

/*
 * ── Several languages ────────────────────────────────────────────────────────
 *
 * Commented out because nothing reads it. This site serves one language, and a
 * live setting that no code consumes is worse than no setting: it promises a
 * behaviour the build does not have.
 *
 * It is written out here rather than only in the guide because this is the file
 * someone opens looking for a language setting, and because a specification
 * kept next to the code it would change is one that stays true. The routing
 * half already works — a page's URL is its path under content/, so
 * content/fr/guides/authoring.mdx is served at /fr/guides/authoring with no new
 * code. What has to be built is the sidebar, the canonical and hreflang set,
 * the freshness check, and the machine outputs.
 *
 * content/guides/internationalization.mdx is the full specification: the two
 * modes, the seventeen surfaces and the file each one lives in, and the
 * assertions an implementation has to satisfy. Read it before writing any of
 * this, and uncommenting this block is the first step.
 *
 * The step before that one is the `generateId` override in content.config.ts.
 * Without it `content/fr/index.mdx` takes the id `fr` and the build stops on a
 * message that names no useful file — and only once a locale translates its
 * homepage, which is late enough to be expensive. The guide explains it.
 *
 * export interface I18nLocale {
 *   name: string;              // shown in the language picker
 *   short: string;             // its collapsed state
 *   language: string;          // `lang` attribute and JSON-LD `inLanguage`
 *   locale: string;            // BCP 47 with region, for `og:locale`
 *   dir?: 'ltr' | 'rtl';       // Arabic, Hebrew, Persian, Urdu
 * }
 *
 * export interface I18nConfig {
 *   locales: Record<string, I18nLocale>;   // key order sets the picker's order
 *   defaultLocale: string;                 // served unprefixed
 *   missing: 'fallback' | 'hide';          // an untranslated page: English, or absent
 *   stale: 'warn' | 'fallback';            // a translation older than its source
 *   navigationLabels: Record<string, Record<string, string>>;
 * }
 *
 * export const i18n: I18nConfig = {
 *   locales: {
 *     en: { name: 'English',  short: 'EN', language: 'en', locale: 'en_US' },
 *     fr: { name: 'Français', short: 'FR', language: 'fr', locale: 'fr_FR' },
 *   },
 *   defaultLocale: 'en',
 *   missing: 'fallback',
 *   stale: 'warn',
 *   navigationLabels: {
 *     fr: { 'Start here': 'Commencer', 'Writing content': 'Rédaction' },
 *   },
 * };
 *
 * `seo.locale` and `seo.language` above become this object's default entry.
 * Delete them from `seo` when you add it, rather than leaving two places that
 * answer "what language is this site".
 */

/**
 * One field the `report_issue` tool asks an agent for.
 *
 * The same declaration produces the tool's JSON Schema and the key in the
 * webhook payload, so what an agent is asked for and what the receiver gets can
 * never drift apart.
 */
export interface FeedbackField {
  name: string;
  type: 'string' | 'enum';
  required: boolean;
  description: string;
  /** Strings only. Enforced server-side by truncation, not by trusting the agent. */
  maxLength?: number;
  /** Enums only. */
  values?: readonly string[];
}

/**
 * The agent-facing surfaces: the MCP server, the HTTP API and the WebMCP bridge.
 *
 * All three serve the same four tools from worker/tools.ts, so this block turns
 * them on together or not at all. A distribution that wants a plain
 * documentation site sets `enabled: false` and pays for nothing: no routes are
 * registered, no index is provisioned, and the build skips the upload step.
 */
export const agents = {
  /** Master switch. Everything below is inert when this is false. */
  enabled: true,

  /** Also expose the tools as plain REST under /api/docs/. */
  http: true,

  /**
   * Where retrieval comes from.
   *
   *   'lexical'    ranked BM25-ish scoring over the build's own index, run
   *                inside the Worker. No external service, no provisioning,
   *                works on the first deploy. The floor.
   *   'ai-search'  Cloudflare AI Search: hybrid vector + keyword with the
   *                corpus pushed at build time. Requires an instance and the
   *                `AI_SEARCH` binding in wrangler.jsonc; falls back to
   *                'lexical' at runtime if the binding is absent, so a
   *                misconfiguration degrades instead of 500ing.
   */
  retrieval: 'ai-search' as 'lexical' | 'ai-search',

  /** Name of the AI Search instance, when `retrieval` is 'ai-search'. */
  aiSearchInstance: 'duvlify-docs',

  /** Passages returned when the caller does not ask for a number. */
  defaultLimit: 8,
  /** Ceiling, so an agent cannot burn its context by accident. */
  maxLimit: 25,

  /**
   * Optional feedback relay. `report_issue` is hidden from tools/list until
   * `webhook` is set — an advertised tool that silently discards its input is
   * worse than no tool.
   *
   * `fields` drives both the tool's JSON Schema and the payload keys, so the
   * two cannot drift. `context` is what the Worker adds itself, which the agent
   * can neither supply nor forge.
   */
  feedback: {
    /**
     * Not read directly at runtime — kept `undefined` here on purpose, so a
     * fresh clone ships with feedback off, matching every other integration in
     * this file. The Worker reads the real value from the `FEEDBACK_WEBHOOK`
     * binding in its `env` instead (see worker/agent/tools.ts), set with
     * `wrangler secret put FEEDBACK_WEBHOOK` rather than written here.
     *
     * The reason is not that the URL is sensitive. A webhook with no token in
     * it is not a secret in the security sense — see the Secrets section of
     * /reference/configuration — so a literal here would compile into the
     * Worker bundle without exposing anything a Worker secret protects any
     * better. The reason is that this exact file is the template every fork of
     * this repository starts from: a literal here would make the upstream
     * maintainer's webhook the default destination for every site built on
     * this framework until its operator noticed and changed it.
     */
    webhook: undefined as string | undefined,
    fields: [
      {
        name: 'problem',
        type: 'string',
        required: true,
        maxLength: 2000,
        description: 'What is wrong, missing or ambiguous, and what was expected instead.',
      },
      {
        name: 'kind',
        type: 'enum',
        required: false,
        values: ['inaccurate', 'outdated', 'missing', 'unclear'],
        description: 'The kind of problem.',
      },
    ] as FeedbackField[],
    context: ['page', 'pageId', 'agent', 'siteVersion', 'reportedAt'] as readonly string[],
  },

  /**
   * The in-browser bridge that republishes these tools to a WebMCP agent.
   *
   *   'off'  Cloudflare's hosted bridge handles it — the "Site MCP server" pack
   *          under Agent Readiness → Labs. Recommended wherever the domain is a
   *          Cloudflare zone, because it costs nothing to maintain.
   *   'on'   this repository registers the tools itself. For a deployment with
   *          no zone, where that dashboard toggle does not exist.
   *
   * Never both: the tools would be registered twice.
   */
  webmcpBridge: 'off' as 'off' | 'on',

  /**
   * Requests per minute per IP, per tool family. Enforced by the Workers rate
   * limiting binding, which only accepts 10- or 60-second windows and counts
   * per datacenter — a coarse abuse damper, not a quota. The real ceiling is a
   * WAF rule on the zone; see the README.
   */
  rateLimit: { search: 30, read: 90, write: 2 },
} as const;

export const theme = {
  font: {
    /**
     * Used for all UI and prose. astro.config.ts feeds this to Astro's fonts
     * API, which downloads the files at build time and serves them from this
     * origin — no request to a font CDN at runtime.
     */
    sans: 'Inter',
    /** A single entry like '400 800' requests that range from a variable font. */
    sansWeights: ['400 800'],
    /** Exposed by the fonts API; ThemeTokens.astro maps it onto --font-sans. */
    sansVariable: '--font-brand',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  },
  accent: {
    /** Fills and tints. */
    base: '#16866a',
    /**
     * Text, borders and active states. Darker than `base` because it has to
     * clear 4.5:1 not just on the page background but on the accent *tints*
     * behind badges, method pills and changelog labels. Those tints are the
     * accent at 12–24% over the background, and this shade clears the bar on
     * all of them: 7.72:1 on the background itself, 5.64:1 on the densest tint.
     *
     * Measure both when you change it. The page background is the easy case and
     * the one a colour picker shows you; the tint is where a plausible-looking
     * accent quietly fails.
     */
    strong: '#0f5e4a',
    /** The same role in dark mode, where `strong` would be too dark. 7.82:1 on
        the dark background, 5.70:1 on the dark tint. */
    strongDark: '#68b09e',
    /**
     * Text placed on top of a solid `base` fill — the topbar's primary button,
     * chiefly. White at 4.51:1 here — the floor, not a margin. `base` is close
     * to the midpoint where neither white nor a dark shade of the same hue
     * clears 4.5:1, so re-measure this pair before nudging `base` either way.
     */
    contrast: '#ffffff',
  },
  /**
   * The topbar's filled "primary" button (`site.header.primary` — "Get
   * started" here) takes the accent colour above by default. Set either
   * field to break that link: a brand's call-to-action button is sometimes a
   * fixed colour that has nothing to do with the site's accent and shouldn't
   * move whenever the accent does — plenty of brands ship a black one.
   * Leaving both `''` keeps today's default, `accent.base` / `accent.contrast`.
   */
  headerPrimary: {
    background: '',
    foreground: '',
  },
  /** Radii step down as elements nest: shells, wells, then controls. */
  radius: {
    lg: '16px', md: '12px', sm: '8px', xs: '6px',
    /**
     * iOS-style "continuous" corners: the curve blends smoothly into each
     * straight edge instead of the abrupt bite of an ordinary circular
     * radius. Native CSS — the `corner-shape` property — applied once,
     * globally, in shell.css; nothing here is a JS or mask polyfill. A
     * browser that doesn't know the property yet just keeps the plain radius
     * set above, because an unrecognised CSS property is inert rather than
     * breaking anything.
     *
     *   none      ordinary round corners
     *   subtle    a light continuous curve — what this site uses
     *   standard  a clearly continuous curve
     *   ios       the spec's own `squircle` keyword — the strongest, most
     *             recognisably-Apple curve
     */
    smoothing: 'subtle' as CornerSmoothing,
  },
} as const;

export const navigation: NavTab[] = [
  {
    id: 'guides',
    label: 'Guides',
    icon: 'rocket',
    groups: [
      { label: 'Start here', icon: 'zap', pages: ['getting-started', 'why'] },
      {
        label: 'Writing content',
        icon: 'file',
        pages: ['guides/authoring', 'guides/api-reference'],
      },
      {
        label: 'Publishing',
        folder: true,
        icon: 'folder',
        /* `guides/migrating` is a draft: it stays listed here, and navigation
           resolution drops it from the built sidebar. Publishing it is one
           frontmatter line, with no config change. */
        pages: ['guides/deployment', 'guides/internationalization', 'guides/migrating'],
      },
    ],
  },
  {
    id: 'reference',
    label: 'Reference',
    icon: 'book',
    groups: [
      {
        label: 'Writing',
        icon: 'file',
        /* Every markup surface an author writes, in one group. `code-and-diagrams`
           used to sit under Guides, which split the authoring vocabulary across
           two tabs and documented diagrams and icons twice. */
        pages: [
          'reference/frontmatter',
          'reference/components',
          'reference/code-and-diagrams',
          'reference/page-layouts',
        ],
      },
      {
        label: 'The framework',
        folder: true,
        icon: 'folder',
        pages: ['reference/configuration', 'reference/theming', 'reference/architecture'],
      },
    ],
  },
  /*
   * A worked example rather than a real API, and the tab label says so.
   *
   * The framework renders endpoint pages from an OpenAPI document, and a site
   * that documents a framework has no API to render. Documenting the feature in
   * prose and never showing it left the largest piece of the layout invisible,
   * so these four pages stand in: a fictional API on api.example.com, driven by
   * src/openapi.config.ts. Every page opens by saying it is not real, and
   * `seo.agentInstructions` above says the same thing to anything reading
   * llms.txt, so a model does not answer from a widget endpoint.
   *
   * Delete this tab and that file together when you replace them with your own.
   */
  {
    id: 'example-api',
    label: 'Example API',
    icon: 'code',
    groups: [
      { label: 'About', icon: 'info', pages: ['example-api/introduction'] },
      {
        label: 'Widgets',
        folder: true,
        icon: 'folder',
        pages: [
          'example-api/list-widgets',
          'example-api/create-widget',
          'example-api/get-widget',
        ],
      },
    ],
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: 'bot',
    groups: [
      { label: 'Overview', icon: 'plug', pages: ['agents/overview'] },
      {
        label: 'The surfaces',
        folder: true,
        icon: 'folder',
        pages: ['agents/mcp', 'agents/retrieval', 'agents/discovery'],
      },
    ],
  },
];
