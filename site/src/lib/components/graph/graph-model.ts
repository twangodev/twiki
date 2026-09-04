import type { GraphData, GraphLink } from './graph-data';

interface GraphSelectionConfig {
	depth: number;
	showTags: boolean;
	removeTags: string[];
}

export interface OrderedGraphElements {
	nodeIds: string[];
	links: GraphLink[];
}

/**
 * Select and order the graph exactly like Quartz's graph.inline.ts.
 *
 * The order is observable: d3-force initializes nodes by array index, and its
 * link force iterates links in insertion order. An adjacency-map BFS returns
 * the same set but produces a visibly different layout, so retain Quartz's
 * per-page outgoing/tag link order and outgoing-before-incoming worklist.
 */
export function orderedGraphElements(
	fullData: GraphData,
	slug: string | undefined,
	config: GraphSelectionConfig
): OrderedGraphElements {
	const data = new Map(fullData.nodes.map((node) => [node.id, node]));
	const validLinks = new Set(data.keys());
	const outgoingBySource = new Map<string, GraphLink[]>();
	for (const link of fullData.links) {
		if (!validLinks.has(link.source) || !validLinks.has(link.target)) continue;
		const outgoing = outgoingBySource.get(link.source);
		if (outgoing) outgoing.push(link);
		else outgoingBySource.set(link.source, [link]);
	}

	const links: GraphLink[] = [];
	const tags: string[] = [];
	for (const [source, details] of data) {
		for (const link of outgoingBySource.get(source) ?? []) {
			links.push({ source: link.source, target: link.target });
		}

		if (!config.showTags) continue;
		const localTags = details.tags
			.filter((tag) => !config.removeTags.includes(tag))
			.map((tag) => `tags/${tag}`);
		tags.push(...localTags.filter((tag) => !tags.includes(tag)));
		for (const tag of localTags) links.push({ source, target: tag });
	}

	const neighbourhood = new Set<string>();
	if (config.depth >= 0 && slug !== undefined) {
		const outgoing = new Map<string, string[]>();
		const incoming = new Map<string, string[]>();
		for (const link of links) {
			const targets = outgoing.get(link.source);
			if (targets) targets.push(link.target);
			else outgoing.set(link.source, [link.target]);
			const sources = incoming.get(link.target);
			if (sources) sources.push(link.source);
			else incoming.set(link.target, [link.source]);
		}

		// Quartz uses a sentinel worklist and deliberately doesn't de-duplicate
		// queued nodes. Keep that traversal order while avoiding repeated scans
		// through the complete link array.
		const sentinel = Symbol('depth');
		const worklist: (string | typeof sentinel)[] = [slug, sentinel];
		let cursor = 0;
		let remainingDepth = config.depth;
		while (remainingDepth >= 0 && cursor < worklist.length) {
			const current = worklist[cursor++];
			if (current === sentinel) {
				remainingDepth--;
				worklist.push(sentinel);
				continue;
			}

			neighbourhood.add(current);
			worklist.push(...(outgoing.get(current) ?? []), ...(incoming.get(current) ?? []));
		}
	} else {
		validLinks.forEach((id) => neighbourhood.add(id));
		if (config.showTags) tags.forEach((tag) => neighbourhood.add(tag));
	}

	return {
		nodeIds: [...neighbourhood],
		links: links.filter((link) => neighbourhood.has(link.source) && neighbourhood.has(link.target))
	};
}

/** Translate a simulation coordinate into canvas space; zero is valid. */
export function canvasPosition(
	x: number | undefined,
	y: number | undefined,
	width: number,
	height: number
): { x: number; y: number } | undefined {
	if (x === undefined || y === undefined) return undefined;
	return { x: x + width / 2, y: y + height / 2 };
}
