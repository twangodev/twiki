import { visit } from 'unist-util-visit';
import type { Root } from 'hast';
import { simplifySlug, stripSlashes, type FullSlug } from './slug';

/** Resolve relative links before folder routes lose their trailing slash. */
export function absolutizeUrls(tree: Root, slug: FullSlug, htmlAssets: Map<string, string>) {
	const simple = simplifySlug(slug);
	const base = 'https://base.com/' + (simple === '/' ? '' : stripSlashes(simple, true));
	const fix = (value: string): string => {
		if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) || value.startsWith('//') || value.startsWith('#'))
			return value;
		const url = new URL(value, base);
		let pathname = url.pathname;
		if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
		// HTML slugs are extensionless internally, but static files retain .html.
		const asset = htmlAssets.get(decodeURIComponent(pathname));
		if (asset) pathname = asset.split('/').map(encodeURIComponent).join('/');
		return pathname + url.search + url.hash;
	};
	visit(tree, 'element', (node) => {
		for (const attribute of ['href', 'src']) {
			const value = node.properties[attribute];
			if (typeof value === 'string') node.properties[attribute] = fix(value);
		}
	});
}
