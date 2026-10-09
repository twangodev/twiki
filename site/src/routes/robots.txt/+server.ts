import { site } from '$lib/config';

export const prerender = import.meta.env.VITE_STATIC_EXPORT === 'true';

export function GET() {
	return new Response(`User-agent: *\nAllow: /\nSitemap: ${site.url}/sitemap.xml\n`, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' }
	});
}
