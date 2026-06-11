import type { RequestHandler } from './$types';
import { rssXml } from '$lib/server/content';

export const prerender = true;

/** RSS feed — same URL and shape as the live Quartz site (limit 10). */
export const GET: RequestHandler = () =>
	new Response(rssXml(), {
		headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' }
	});
