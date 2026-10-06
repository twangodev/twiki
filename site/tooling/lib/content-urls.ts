import { visitElements } from './visit-elements';
import type { Root } from 'hast';
import { simplifySlug, stripSlashes, type FullSlug } from './slug';

export function htmlAssetPaths(assets: { rel: string; slug: FullSlug }[]): Map<string, string> {
	return new Map(
		assets
			.filter((asset) => asset.rel.toLowerCase().endsWith('.html'))
			.map((asset) => [`/${simplifySlug(asset.slug)}`.replace(/\/$/, ''), `/${asset.slug}.html`])
	);
}

function isLocalContentUrl(value: string): boolean {
	return !(
		/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) ||
		value.startsWith('//') ||
		value.startsWith('#')
	);
}

function resolveContentUrl(
	value: string,
	pageUrl: URL,
	assetPaths: ReadonlyMap<string, string>
): string {
	if (!isLocalContentUrl(value)) return value;

	const url = new URL(value, pageUrl);
	const route = url.pathname.replace(/\/$/, '') || '/';
	const assetPath = assetPaths.get(decodeURIComponent(route));
	const pathname = assetPath ? assetPath.split('/').map(encodeURIComponent).join('/') : route;
	return pathname + url.search + url.hash;
}

export function rewriteContentUrls(
	tree: Root,
	slug: FullSlug,
	assetPaths: ReadonlyMap<string, string>
) {
	const pagePath = stripSlashes(simplifySlug(slug), true);
	const pageUrl = new URL(`/${pagePath}`, 'https://content.invalid');

	visitElements(tree, (node) => {
		for (const attribute of ['href', 'src']) {
			const value = node.properties[attribute];
			if (typeof value === 'string')
				node.properties[attribute] = resolveContentUrl(value, pageUrl, assetPaths);
		}
	});
}
