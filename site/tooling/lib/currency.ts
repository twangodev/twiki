import type { Root } from 'mdast';
import type { InlineMath } from 'mdast-util-math';
import { visit } from 'unist-util-visit';

/** Recognize paired prices that remark-math would silently consume as inline math. */
export function isCurrencyMath(node: InlineMath, source: string): boolean {
	const start = node.position?.start.offset;
	const end = node.position?.end.offset;
	if (start == null || end == null) return false;
	const raw = source.slice(start, end);
	// Only single-dollar spans starting with an amount and ending at the next amount.
	// Explicit LaTeX and ordinary $2 + 3$ / $x$ expressions remain unchanged.
	if (!/^\$\d/.test(raw) || !/^\d/.test(source.slice(end))) return false;
	if (/[\\\r\n]/.test(node.value)) return false;
	return (
		(/\s\$$/.test(raw) && /\b[A-Za-z]{2,}\b/.test(node.value)) || /^[\d.,\s–—-]+$/.test(node.value)
	);
}

/** Restore the exact literal text, including both dollar signs and all spacing. */
export function preserveCurrency(source: string) {
	return (tree: Root) => {
		visit(tree, 'inlineMath', (node, index, parent) => {
			if (parent && index != null && isCurrencyMath(node, source)) {
				parent.children[index] = {
					type: 'text',
					value: source.slice(node.position!.start.offset!, node.position!.end.offset!),
					position: node.position
				};
			}
		});
	};
}
