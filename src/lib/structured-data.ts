/**
 * The JSON-LD graph emitted on every page.
 *
 * One `@graph` rather than several disconnected blocks, with every node given a
 * stable `@id` and referenced by it. That is what lets a consumer resolve
 * "who published this" or "where does this page sit" instead of re-reading the
 * same organisation object on each node — and it is how Google's own examples
 * are shaped.
 *
 * What is emitted, and why each one earns its bytes:
 *
 *   Organization   who stands behind the content. Feeds knowledge panels, and
 *                  gives assistants an entity to attribute a quote to.
 *   WebSite        the site as a thing, so pages are parts of something.
 *   TechArticle    the page. `APIReference` for endpoint pages, which is the
 *                  schema.org subtype that exists for exactly that.
 *   BreadcrumbList the position in the hierarchy, rendered as the breadcrumb
 *                  trail in search results instead of a bare URL.
 *
 * FAQPage is deliberately not among them. It used to be, reading the
 * question-shaped accordions off each page. Google restricted that rich result
 * to health and government sites in 2023, so it no longer renders for anyone
 * here — and the markup carried a real cost in exchange for nothing: an
 * accordion that illustrates a widget rather than answering a question is
 * mismatched structured data, which is the kind of thing that earns a manual
 * action. Generative engines read the page's own headings and prose perfectly
 * well without it.
 */
import { seo, site, withBase } from '../docs.config';
import { markdownUrl } from './markdown-url';
import type { ResolvedGroup, ResolvedPage, ResolvedTab } from './navigation';

type Node = Record<string, unknown>;

export interface PageSchemaInput {
  origin: URL;
  url: string;
  title: string;
  description: string;
  tab?: ResolvedTab;
  group?: ResolvedGroup;
  page?: ResolvedPage;
  image: string;
  published?: Date;
  modified?: Date;
  /** Endpoint pages describe an API, which has its own schema.org type. */
  isApiReference: boolean;
}

const absolute = (origin: URL, path: string) => new URL(path, origin).href;

export function buildStructuredData(input: PageSchemaInput): Node {
  const { origin, url } = input;
  const organizationId = `${origin.origin}/#organization`;
  const websiteId = `${origin.origin}/#website`;
  const pageId = `${url}#page`;

  const organization: Node = {
    '@type': 'Organization',
    '@id': organizationId,
    name: seo.organization.name,
    url: seo.organization.url,
    logo: {
      '@type': 'ImageObject',
      url: absolute(origin, withBase(seo.organization.logo as `/${string}`)),
    },
    ...(seo.organization.sameAs.length ? { sameAs: [...seo.organization.sameAs] } : {}),
  };

  const website: Node = {
    '@type': 'WebSite',
    '@id': websiteId,
    url: origin.origin,
    name: `${site.name} documentation`,
    description: site.description,
    inLanguage: seo.language,
    publisher: { '@id': organizationId },
  };

  const article: Node = {
    /* APIReference is a subtype of TechArticle, so a consumer that only knows
       the parent type still understands the page. */
    '@type': input.isApiReference ? 'APIReference' : 'TechArticle',
    '@id': pageId,
    url,
    name: input.title,
    headline: input.title,
    description: input.description,
    inLanguage: seo.language,
    isPartOf: { '@id': websiteId },
    publisher: { '@id': organizationId },
    author: { '@id': organizationId },
    image: input.image,
    ...(input.published ? { datePublished: input.published.toISOString() } : {}),
    ...(input.modified ? { dateModified: input.modified.toISOString() } : {}),
    ...(input.tab ? { articleSection: input.tab.label } : {}),
    /* Points assistants at the clean copy of exactly this page. */
    encoding: {
      '@type': 'MediaObject',
      encodingFormat: 'text/markdown',
      contentUrl: markdownUrl(url),
    },
  };

  const trail = [
    { name: site.name, item: absolute(origin, site.home) },
    ...(input.tab ? [{ name: input.tab.label, item: absolute(origin, input.tab.href) }] : []),
    ...(input.group?.folder ? [{ name: input.group.label }] : []),
    { name: input.title, item: url },
  ];

  const breadcrumbs: Node = {
    '@type': 'BreadcrumbList',
    '@id': `${url}#breadcrumbs`,
    itemListElement: trail.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      ...(crumb.item ? { item: crumb.item } : {}),
    })),
  };

  return {
    '@context': 'https://schema.org',
    '@graph': [organization, website, article, breadcrumbs],
  };
}
