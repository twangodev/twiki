import { visit } from 'unist-util-visit';
import type { Root, Element } from 'hast';

export function protectPublicLinks(tree: Root, page: string, allowed: Set<string>) {
	const permitted = (value: string) => {
		const url = new URL(value, `https://wisconsin.twango.dev/${page}`);
		if (url.origin !== 'https://wisconsin.twango.dev') return true;
		const target = decodeURIComponent(url.pathname).replace(/^\/|\/$/g, '');
		return (
			allowed.has(target) ||
			allowed.has(`${target}/index`) ||
			(target === '' && allowed.has('index'))
		);
	};
	visit(tree, 'element', (node) => {
		const classes = node.properties.className;
		if (node.tagName === 'blockquote' && Array.isArray(classes) && classes.includes('transclude')) {
			const link = node.children[0] as Element | undefined;
			if (typeof link?.properties?.href === 'string' && !permitted(link.properties.href))
				throw new Error(
					`${page}: transclusion requires explicit publication: ${link.properties.href}`
				);
		}
		for (const attribute of ['src', 'poster', 'data', 'srcSet']) {
			const value = node.properties[attribute];
			if (typeof value !== 'string') continue;
			const urls =
				attribute === 'srcSet'
					? value.split(',').map((part) => part.trim().split(/\s+/)[0])
					: [value];
			for (const url of urls)
				if (!permitted(url))
					throw new Error(`${page}: embedded asset requires explicit publication: ${url}`);
		}
		if (typeof node.properties.href === 'string' && !permitted(node.properties.href)) {
			if (node.tagName !== 'a')
				throw new Error(
					`${page}: linked resource requires explicit publication: ${node.properties.href}`
				);
			delete node.properties.href;
			delete node.properties['data-slug'];
			delete node.properties.className;
			node.tagName = 'span';
		}
	});
}
