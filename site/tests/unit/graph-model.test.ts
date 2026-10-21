import { describe, expect, test } from 'bun:test';
import type { GraphData } from '../../src/lib/components/graph/graph-data';
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

test('tag nodes keep first-occurrence order while parallel tag links remain ordered', () => {
	const graph: GraphData = {
		nodes: [
			{ id: 'a', title: 'A', tags: ['shared', 'shared', 'excluded'] },
			{ id: 'b', title: 'B', tags: ['shared', 'second'] }
		],
		links: [{ source: 'a', target: 'b' }]
	};
	const config = { depth: -1, showTags: true, removeTags: ['excluded'] };
	const global = orderedGraphElements(graph, 'a', config);
	expect(global).toEqual({
		nodeIds: ['a', 'b', 'tags/shared', 'tags/second'],
		links: [
			{ source: 'a', target: 'b' },
			{ source: 'a', target: 'tags/shared' },
			{ source: 'a', target: 'tags/shared' },
			{ source: 'b', target: 'tags/shared' },
			{ source: 'b', target: 'tags/second' }
		]
	});
	expect(orderedGraphElements(graph, 'a', { ...config, depth: 1 })).toEqual({
		nodeIds: ['a', 'b', 'tags/shared'],
		links: global.links.slice(0, -1)
	});
	expect(orderedGraphElements(graph, undefined, { ...config, showTags: false })).toEqual({
		nodeIds: ['a', 'b'],
		links: graph.links
	});
});
