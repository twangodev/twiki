/**
 * URL normalization for Pagefind results.
 *
 * SvelteKit (trailingSlash 'never') prerenders pages as flat `<route>.html`
 * files, so Pagefind reports result URLs like `/sp26-cs537/p2.html#anchor`.
 * The deployed site serves those routes extensionless (Cloudflare static
 * assets `html_handling`), and the canonical URL space has no `.html`
 * (parity with Quartz), so strip the extension before navigating/displaying.
 */
export function cleanResultUrl(raw: string): string {
	const hashIdx = raw.indexOf('#');
	const anchor = hashIdx === -1 ? '' : raw.slice(hashIdx);
	let path = hashIdx === -1 ? raw : raw.slice(0, hashIdx);
	path = path.replace(/\.html$/, '');
	// Pagefind already maps `index.html` -> `/`, but normalize defensively.
	if (path.endsWith('/index')) path = path.slice(0, -'index'.length);
	if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
	if (path === '') path = '/';
	return path + anchor;
}
