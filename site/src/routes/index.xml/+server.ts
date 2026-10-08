import type { RequestHandler } from './$types';
import { requestContent } from '$lib/server/runtime-content';
export const prerender = import.meta.env.VITE_STATIC_EXPORT === 'true';
export const GET: RequestHandler = async ({ platform }) =>
	new Response((await requestContent(platform).model()).rssXml(), {
		headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' }
	});
