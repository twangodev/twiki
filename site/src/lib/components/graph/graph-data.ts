/** Lazily fetch and cache the prerendered /graph.json endpoint. */

export interface GraphNode {
	id: string;
	title: string;
	tags: string[];
}

export interface GraphLink {
	source: string;
	target: string;
}

export interface GraphData {
	nodes: GraphNode[];
	links: GraphLink[];
}

let graphPromise: Promise<GraphData> | undefined;

/** Fetch (once) and cache the sitewide graph. */
export function loadGraph(fetcher: typeof fetch = fetch): Promise<GraphData> {
	graphPromise ??= fetcher('/graph.json').then((res) => {
		if (!res.ok) {
			graphPromise = undefined; // allow retry on transient failure
			throw new Error(`Failed to load /graph.json: ${res.status}`);
		}
		return res.json() as Promise<GraphData>;
	});
	return graphPromise;
}

// Node ordering affects the seeded force layout; keep it stable in graph-model.ts.

export interface GraphConfig {
	drag: boolean;
	zoom: boolean;
	depth: number;
	scale: number;
	repelForce: number;
	centerForce: number;
	linkDistance: number;
	fontSize: number;
	opacityScale: number;
	removeTags: string[];
	showTags: boolean;
	focusOnHover: boolean;
	enableRadial: boolean;
	centerCurrentNode: boolean;
}

export const localGraphConfig: GraphConfig = {
	drag: true,
	zoom: true,
	depth: 2,
	scale: 1.1,
	repelForce: 0.5,
	centerForce: 0.3,
	linkDistance: 30,
	fontSize: 0.6,
	opacityScale: 1,
	showTags: true,
	removeTags: [],
	focusOnHover: false,
	enableRadial: false,
	centerCurrentNode: true
};

export const globalGraphConfig: GraphConfig = {
	drag: true,
	zoom: true,
	depth: -1,
	scale: 0.9,
	repelForce: 0.5,
	centerForce: 0.2,
	linkDistance: 30,
	fontSize: 0.6,
	opacityScale: 1,
	showTags: true,
	removeTags: [],
	focusOnHover: true,
	enableRadial: true,
	centerCurrentNode: false
};

// ---------------------------------------------------------------------------
// Visited tracking — Quartz keeps a `graph-visited` set in localStorage and
// tints visited nodes differently from unvisited ones.
// ---------------------------------------------------------------------------

const visitedKey = 'graph-visited';

export function getVisited(): Set<string> {
	try {
		return new Set(JSON.parse(localStorage.getItem(visitedKey) ?? '[]'));
	} catch {
		return new Set();
	}
}

export function addToVisited(id: string): void {
	try {
		const visited = getVisited();
		visited.add(id);
		localStorage.setItem(visitedKey, JSON.stringify([...visited]));
	} catch {
		// localStorage unavailable (private mode etc.) — visited is cosmetic
	}
}

// ---------------------------------------------------------------------------
// Route ↔ node id mapping
// ---------------------------------------------------------------------------

/** Display-form node id → site href (SvelteKit route, trailingSlash 'never'). */
export function hrefForId(id: string): string {
	if (id === '/' || id === '') return '/';
	return `/${id.replace(/\/+$/, '')}`;
}

/**
 * Current pathname → graph node id, or undefined when the route has no node
 * (generated folder listings, 404). `/tags/<tag>` pages resolve to the
 * synthesized `tags/<tag>` node when any page carries that tag, matching
 * Quartz where tag pages are part of the content index.
 */
export function idForRoute(pathname: string, data: GraphData): string | undefined {
	const route = decodeURIComponent(pathname).replace(/^\/+|\/+$/g, '');
	if (route === '') return data.nodes.some((n) => n.id === '/') ? '/' : undefined;
	if (data.nodes.some((n) => n.id === route)) return route;
	if (data.nodes.some((n) => n.id === `${route}/`)) return `${route}/`; // folder index page
	if (route.startsWith('tags/')) {
		const tag = route.slice('tags/'.length);
		if (data.nodes.some((n) => n.tags.includes(tag))) return route;
	}
	return undefined;
}
