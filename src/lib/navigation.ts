/**
 * Resolves docs.config.ts against the content collection.
 *
 * The config declares *structure* (which pages, in which order, grouped how).
 * Each page's frontmatter declares its own *identity* (title, description, icon,
 * badge). This module joins the two, so neither restates the other, and every
 * consumer — sidebar, tabs, breadcrumb, prev/next, search — reads the same tree.
 *
 * Mismatches fail the build rather than degrading silently.
 */
import { render } from 'astro:content';
import { navigation, navigationLayout, site, type NavTab } from '../docs.config';
import { toSections } from './plain-text';
import { byId, getAllDocs, getPublishedDocs } from './published';

export interface ResolvedPage {
  id: string;
  href: string;
  /** Sidebar label: `sidebarTitle` if set, otherwise the page title. */
  label: string;
  title: string;
  description: string;
  icon?: string;
  badge?: string;
  apiMethod?: string;
}

export interface ResolvedGroup {
  label: string;
  folder: boolean;
  /**
   * Whether this folder starts open, before the current page is taken into
   * account.
   *
   * Resolved here rather than read in the component, because it is a join of the
   * group's own `defaultOpen` and the site-wide `expandFolders` — and every other
   * config-to-content join happens in this file. The component adds the one part
   * this cannot know: whether the folder holds the page being read.
   */
  defaultOpen: boolean;
  icon?: string;
  sidebarOrder?: number;
  pages: ResolvedPage[];
}

export interface ResolvedTab {
  id: string;
  label: string;
  icon: string;
  /** The tab's first page — where clicking the tab lands. */
  href: string;
  groups: ResolvedGroup[];
}

/**
 * The one place a page id becomes a URL. The optional homepage has a content
 * id, but is served at the site root rather than at that id's literal path.
 *
 * This is also where `site.basePath` is applied, and being the only place is
 * what makes a subpath deployment safe: canonical tags, the sitemap, llms.txt,
 * the agent manifest and every tool response all build their absolute URLs from
 * this string, so one prefix here reaches all of them. Anything that hand-built
 * a path instead would be the one link that breaks under `/docs`.
 */
export const isHomePage = (id: string) => site.homePageId === id;
export const hrefFor = (id: string) =>
  isHomePage(id) ? `${site.basePath}/` : `${site.basePath}/${id}`;

/** Whether the config names this page anywhere in the sidebar, draft or not. */
const isInNavigation = (id: string) =>
  navigation.some((tab: NavTab) => tab.groups.some(group => group.pages.includes(id)));

let cache: ResolvedTab[] | null = null;

/**
 * The full navigation tree. Resolved once per build.
 *
 * Two failure modes are deliberately kept apart. A page id the config names but
 * that has no file at all is a typo, and fails the build — silently dropping it
 * would leave a hole in the sidebar that nobody notices until a reader reports
 * it. A page id that names a draft is an author's decision, and is skipped
 * without a word, taking any group or tab it empties with it. Telling the two
 * apart is the only reason this reads the unfiltered collection.
 */
export async function getNavigation(): Promise<ResolvedTab[]> {
  if (cache) return cache;

  const published = byId(await getPublishedDocs());
  const onDisk = byId(await getAllDocs());

  if (site.homePageId && !onDisk.has(site.homePageId)) {
    throw new Error(
      `docs.config.ts declares homepage "${site.homePageId}", but content/${site.homePageId}.mdx does not exist.`,
    );
  }

  /* Checked against the config rather than the resolved tree: drafting the
     homepage must not turn a misconfiguration into a silent pass. */
  if (site.homePageId && isInNavigation(site.homePageId)) {
    throw new Error(
      `Homepage "${site.homePageId}" must not appear in docs.config.ts navigation. ` +
        'It is served at / and reached through the site brand.',
    );
  }

  const referenced = new Set<string>();

  const tabs = navigation.flatMap((tab: NavTab) => {
    if (!tab.groups.some(group => group.pages.length)) {
      throw new Error(`docs.config.ts tab "${tab.label}" has no pages.`);
    }

    const groups = tab.groups
      .map(group => ({
        label: group.label,
        folder: group.folder ?? false,
        defaultOpen: group.defaultOpen ?? navigationLayout.expandFolders === 'all',
        icon: group.icon,
        sidebarOrder: group.sidebarOrder,
        pages: group.pages.flatMap(id => {
          if (!onDisk.has(id)) {
            throw new Error(
              `docs.config.ts references page "${id}" in ${tab.label} › ${group.label}, ` +
                `but content/${id}.mdx does not exist.`,
            );
          }
          const entry = published.get(id);
          /* A draft leaves no trace in the sidebar. */
          if (!entry) return [];
          referenced.add(id);
          return [{
            id,
            href: hrefFor(id),
            label: entry.data.sidebarTitle || entry.data.title,
            title: entry.data.title,
            description: entry.data.description,
            icon: entry.data.icon,
            badge: entry.data.badge,
            apiMethod: entry.data.apiMethod,
          }];
        }),
      }))
      /* A group whose every page is a draft is not an empty section to render;
         it is a section that does not exist yet. */
      .filter(group => group.pages.length > 0)
      /*
       * A folder holding one page is not a folder. It renders as a disclosure
       * the reader has to open to find a single item, which is a worse version
       * of the plain labelled section the same group would have been.
       *
       * Resolved here rather than trusted from the config, because the count
       * that matters is the published one. `folder: true` is written against the
       * pages an author *listed*, and drafts are dropped a few lines above — so a
       * two-page folder with one draft in it silently becomes a one-page folder,
       * and the config still reads as though it were fine. That is exactly how
       * Publishing › Deploying ended up alone in a disclosure.
       *
       * Nothing else changes: the group keeps its label, its icon and its
       * position, and `eyebrow`/`breadcrumb` below already read this same
       * resolved flag, so a page in a collapsed folder stops claiming a folder
       * it is no longer in.
       */
      .map(group => (group.folder && group.pages.length < 2 ? { ...group, folder: false } : group));

    const first = groups[0]?.pages[0];
    /* Same reasoning one level up: a fully drafted tab disappears rather than
       rendering as a tab that leads nowhere. */
    if (!first) return [];

    return [{ id: tab.id, label: tab.label, icon: tab.icon, href: first.href, groups }];
  });

  if (!tabs.length) {
    throw new Error(
      'docs.config.ts resolves to no navigation at all: every page it references is a draft. ' +
        'Publish at least one page.',
    );
  }

  /* A homepage is intentionally outside the docs tree. It remains a normal,
     public document for routes, SEO, the sitemap and the Markdown corpus.
     Drafts are absent from `published`, so they are never orphans. */
  const orphans = [...published.values()]
    .filter(entry => !referenced.has(entry.id) && !isHomePage(entry.id))
    .map(entry => entry.id);
  if (orphans.length) {
    throw new Error(
      `These pages exist but are missing from docs.config.ts navigation: ${orphans.join(', ')}. ` +
        `Add them to a group, or set "draft: true" in their frontmatter.`,
    );
  }

  cache = tabs;
  return tabs;
}

/**
 * The optional homepage, once publication has been taken into account.
 *
 * The sitemap and the Markdown corpus both list it ahead of the sidebar pages,
 * and both must drop it when it is a draft — so the resolution lives here
 * rather than being spelled out from `site.homePageId` at each call site.
 */
export async function getHomePage(): Promise<{ id: string; href: string } | undefined> {
  if (!site.homePageId) return undefined;
  await getNavigation();
  const published = byId(await getPublishedDocs());
  const entry = published.get(site.homePageId);
  return entry ? { id: entry.id, href: hrefFor(entry.id) } : undefined;
}

/** Everything a single page needs to render its shell, resolved from one lookup. */
export async function getPageContext(id: string) {
  const tabs = await getNavigation();
  const flat = await getFlatPages();
  const index = flat.findIndex(item => item.page.id === id);
  const current = flat[index];

  return {
    tabs,
    activeTab: current?.tab ?? tabs[0],
    activeGroup: current?.group,
    activePage: current?.page,
    /** Folder groups act as a section label above the page title. */
    eyebrow: current?.group.folder ? current.group.label : undefined,
    breadcrumb: current?.group.folder ? current.group.label : (current?.tab.label ?? ''),
    previous: index > 0 ? flat[index - 1].page : undefined,
    next: index >= 0 && index < flat.length - 1 ? flat[index + 1].page : undefined,
  };
}

/** Every page in sidebar order, with the tab and group it belongs to. */
export async function getFlatPages() {
  const tabs = await getNavigation();
  const groups = tabs.flatMap(tab => tab.groups.map(group => ({ tab, group })));
  if (navigationLayout.mode === 'unified-sidebar') {
    groups.sort((a, b) =>
      (a.group.sidebarOrder ?? Number.MAX_SAFE_INTEGER) -
      (b.group.sidebarOrder ?? Number.MAX_SAFE_INTEGER),
    );
  }
  return groups.flatMap(({ tab, group }) =>
    group.pages.map(page => ({ page, group, tab })),
  );
}

/**
 * The full-text search index, served as one static JSON file
 * (src/pages/search-index.json.ts) and fetched on first use — never inlined
 * into a page, so page weight stays flat as the docs grow.
 *
 * Keys are short because they repeat once per section across the whole file.
 */
export async function getSearchIndex() {
  const tabs = await getNavigation();
  const entries = byId(await getPublishedDocs());

  const pages = await Promise.all(
    (await getFlatPages()).map(async ({ page, group, tab }) => {
      const entry = entries.get(page.id)!;
      const { headings } = await render(entry);
      return {
        h: page.href,
        t: page.title,
        s: `${tab.label} · ${group.label}`,
        d: page.description,
        k: entry.data.pageType === 'api-endpoint' ? 'endpoint' : 'page',
        m: entry.data.apiMethod,
        b: toSections(entry.body ?? '', headings),
      };
    }),
  );

  /* The homepage is searchable but is not a shortcut or a sidebar result. */
  const homePage = await getHomePage();
  if (homePage) {
    const home = entries.get(homePage.id)!;
    const { headings } = await render(home);
    pages.unshift({
      h: homePage.href,
      t: home.data.title,
      s: 'Home',
      d: home.data.description,
      k: 'page',
      m: undefined,
      b: toSections(home.body ?? '', headings),
    });
  }

  /* One curated shortcut per sidebar group, shown before anything is typed. */
  const quick = tabs.flatMap(tab =>
    tab.groups.flatMap(group =>
      group.pages.slice(0, 1).map(page => ({
        h: page.href,
        t: page.title,
        s: `${tab.label} · ${group.label}`,
        k: page.apiMethod ? 'endpoint' : 'page',
        m: page.apiMethod,
      })),
    ),
  );

  return { quick, pages };
}
