import type { Element, Root } from 'hast';
import { SKIP } from 'unist-util-visit';

/** Preorder HAST traversal for visitors that only mutate the current element.
 * Child mutations are visited immediately; SKIP prunes the current subtree.
 * Sibling replacement and index/ancestor callbacks still need unist-util-visit.
 */
export function visitElements(
	tree: Root | Element,
	visitor: (node: Element) => void | typeof SKIP
) {
	if (tree.type === 'element' && visitor(tree) === SKIP) return;
	for (let index = 0; index < tree.children.length; index++) {
		const child = tree.children[index];
		if (child.type === 'element') visitElements(child, visitor);
	}
}
