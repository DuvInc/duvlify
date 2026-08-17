import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * A page declares only what it is. Where it sits in the sidebar — and therefore
 * its category, its section label and its neighbours — comes from
 * docs.config.ts. Its URL is its path under content/, so content/guides/x.mdx
 * is served at /guides/x.
 */
const docs = defineCollection({
  loader: glob({ base: './content', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string().min(2),
    /**
     * Aim for 150–160 characters: longer than that is truncated in results.
     *
     * Aim for ~140 if the site will ever be translated. German and Spanish run
     * 15–25% longer than English, so a description sitting comfortably at 160
     * comes back over the cap and fails validation on the *translated* file —
     * naming a file whose source is what actually has to be shortened.
     * content/guides/internationalization.mdx covers the rest of that interaction.
     */
    description: z.string().min(10).max(170),
    /** Shorter label for the sidebar, when the page title is too long for it. */
    sidebarTitle: z.string().optional(),
    /** Icon name from src/components/Icon.astro, shown beside the sidebar label. */
    icon: z.string().optional(),
    /** Small pill beside the sidebar label, e.g. "New". */
    badge: z.string().optional(),
    /** Selects the endpoint-specific three-column API reference layout. */
    pageType: z.enum(['api-endpoint']).optional(),
    /** Keep the normal table of contents even when the page contains rail-capable components. */
    rightRail: z.enum(['toc', 'custom']).default('toc'),
    /** OpenAPI operation identity. Generated from the spec, never hand-edited. */
    apiMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    apiPath: z.string().optional(),
    apiOperationId: z.string().optional(),
    apiTag: z.string().optional(),
    /** Excluded from the build and from navigation validation. */
    draft: z.boolean().default(false),

    /* ── Search and social ─────────────────────────────────────────────────
       All optional. A page that sets none of these still gets a full metadata
       set: a generated share card, a canonical URL, and structured data. */

    /** Share card for this page. Defaults to one generated from its title. */
    image: z.string().optional(),
    /** Alt text for that card, when a custom `image` is supplied. */
    imageAlt: z.string().optional(),
    /**
     * Keeps the page in the build and in navigation, but out of search results
     * and the sitemap. For a page that must exist and must not rank.
     */
    noindex: z.boolean().default(false),
    /**
     * Overrides the last-modified date, which otherwise comes from the file's
     * last commit. Set it when a change was substantive and the commit history
     * does not reflect that — a typo fix should not reset a page's freshness.
     */
    updated: z.coerce.date().optional(),
    /** First publication date, when it differs meaningfully from the last edit. */
    published: z.coerce.date().optional(),
  }),
});

export const collections = { docs };
