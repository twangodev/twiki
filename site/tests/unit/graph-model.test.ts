import { describe, expect, test } from 'bun:test';
import { canvasPosition, orderedGraphElements } from '../../src/lib/components/graph/graph-model';

describe('graph model', () => {
	test('orders outgoing neighbours before incoming neighbours', () => {
		const graph = {
			nodes: [
				{ id: 'a', title: 'A', tags: [] },
				{ id: 'current', title: 'Current', tags: ['topic'] },
				{ id: 'b', title: 'B', tags: [] },
				{ id: 'c', title: 'C', tags: [] }
			],
			links: [
				{ source: 'a', target: 'current' },
				{ source: 'current', target: 'b' },
				{ source: 'b', target: 'c' }
			]
		};

		const selected = orderedGraphElements(graph, 'current', {
			depth: 1,
			showTags: true,
			removeTags: []
		});
		expect(selected.nodeIds).toEqual(['current', 'b', 'tags/topic', 'a']);
		expect(selected.links).toEqual([
			{ source: 'a', target: 'current' },
			{ source: 'current', target: 'b' },
			{ source: 'current', target: 'tags/topic' }
		]);
	});

	test('renders a zero simulation coordinate at canvas center', () => {
		expect(canvasPosition(0, 0, 314, 250)).toEqual({ x: 157, y: 125 });
		expect(canvasPosition(undefined, 0, 314, 250)).toBeUndefined();
	});
});
