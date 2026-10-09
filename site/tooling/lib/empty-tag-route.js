import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Empty tag indexes have no concrete dynamic pages for SvelteKit to prerender.
 * @param {string} site
 * @param {string[]} routes
 */
export function emptyTagRoute(site, routes) {
	if (routes.length === 0 || !routes.every((route) => route === '/tags/[...tag]')) return false;
	try {
		const manifest = JSON.parse(
			readFileSync(path.join(site, 'build/generated/content-manifest.json'), 'utf8')
		);
		return (
			manifest?.tags !== null &&
			typeof manifest?.tags === 'object' &&
			!Array.isArray(manifest.tags) &&
			Object.keys(manifest.tags).length === 0
		);
	} catch {
		return false;
	}
}
