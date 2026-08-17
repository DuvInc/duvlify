import type { APIRoute } from 'astro';
import { site } from '../docs.config';
import { cardPng } from '../lib/og-card';

/**
 * The site-wide share card. Used by any page that declares no `image` of its
 * own and has no generated card — the 404 page, and anything added later that
 * sits outside the content collection.
 */
export const GET: APIRoute = async () =>
  new Response(new Uint8Array(await cardPng({ title: `${site.name} documentation`, description: site.description })), {
    headers: { 'Content-Type': 'image/png' },
  });
