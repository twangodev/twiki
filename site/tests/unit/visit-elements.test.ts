import { expect, test } from 'bun:test';
import { SKIP, visit } from 'unist-util-visit';
import type { Element, Root } from 'hast';
import { visitElements } from '../../tooling/lib/visit-elements';

function element(tagName: string, children: Element['children'] = []): Element {
	return { type: 'element', tagName, properties: {}, children };
}

const content: Root = {
	type: 'root',
	children: [
		{ type: 'comment', value: 'hidden' },
		element('div', [element('p', [{ type: 'text', value: 'words' }])]),
		element('blockquote', [element('a', [{ type: 'text', value: 'note' }])]),
		element('a')
	]
};

test('element traversal preserves preorder, mutated children and subtree skipping', () => {
	const run = (walk: (tree: Root, visitor: (node: Element) => void | typeof SKIP) => void) => {
		const tree = structuredClone(content);
		const order: string[] = [];
		walk(tree, (node) => {
			order.push(node.tagName);
			if (node.tagName === 'blockquote') {
				node.children = [element('h1')];
				return SKIP;
			}
			if (node.tagName === 'a') node.children.push(element('svg', [element('path')]));
			if (node.tagName === 'p') node.tagName = 'span';
		});
		return { tree, order };
	};
	const expected = run((tree, visitor) => visit(tree, 'element', visitor));
	expect(run(visitElements)).toEqual(expected);
	expect(expected.order).toEqual(['div', 'p', 'blockquote', 'a', 'svg', 'path']);
});

test('raw HTML cannot hide resource checks behind renderer class names', () => {
	const tree: Root = {
		type: 'root',
		children: [
			{ ...element('span', [element('iframe')]), properties: { className: ['katex'] } },
			{ ...element('pre', [element('a')]), properties: { className: ['shiki'] } }
		]
	};
	const tags: string[] = [];
	visitElements(tree, (node) => {
		tags.push(node.tagName);
	});
	expect(tags).toEqual(['span', 'iframe', 'pre', 'a']);
});
