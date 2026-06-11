import type { RequestHandler } from './$types';
import { sitemapXml } from '$lib/server/content';

export const prerender = true;

/** Sitemap — same URL and shape as the live Quartz site (all leaf pages). */
export const GET: RequestHandler = () =>
	new Response(sitemapXml(), {
		headers: { 'Content-Type': 'application/xml; charset=utf-8' }
	});
