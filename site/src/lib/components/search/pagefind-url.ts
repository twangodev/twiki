/** Convert Pagefind HTML paths to extensionless routes, preserving anchors. */
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
