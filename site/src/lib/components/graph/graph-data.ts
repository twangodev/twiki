/**
 * Client-side data layer for the knowledge-graph viewer.
 *
 * The graph (nodes + links) comes from the prebuild manifest and is served as
 * a prerendered static endpoint at `/graph.json` (~275 kB raw, gzips to a
 * fraction of that). It is fetched lazily, once, the first time any graph
 * component mounts — no graph data is embedded in page payloads or in the
 * initial JS bundle.
 *
 * Node ids are display-form slugs as emitted by `scripts/build-content.ts`:
 *   - `'/'`                         → the homepage
 *   - `'sp26-cs537/README'`         → a leaf page
 *   - `'fa24-asianam160/lectures/'` → a folder index page (trailing slash)
 *   - `'tags/<tag>'`                → tag nodes, synthesized by render-graph
 *                                     when `showTags` is on (Quartz parity)
 */

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

// ---------------------------------------------------------------------------
// Graph configuration — Quartz parity.
//
// Mirrors quartz/components/Graph.tsx `defaultOptions` (everything default).
//
// NOTE on depth: Quartz's local-graph default is depth 1, and that is what
// makes the current note render centered. With `forceCenter()` the simulation
// pulls the *centroid* of the rendered neighbourhood to the origin (0,0) — and
// the render loop then offsets the origin to the canvas centre (x + width/2,
// y + height/2). At depth 1 the neighbourhood is a star whose hub is the
// current note, so the centroid coincides with the current note and it sits
// dead-centre. At depth 2 the neighbourhood balloons (e.g. a leaf hanging off a
// 78-degree course-README hub pulls in that hub and all its siblings), the
// centroid shifts to the dense hub cluster, and the current note drifts to the
// periphery — measured up to ~0.5–0.75 of the layout radius off-centre on this
// corpus. Quartz offers no current-node anchoring beyond forceCenter, so the
// only reference-faithful way to keep the current note centred is depth 1.
// ---------------------------------------------------------------------------

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
}

export const localGraphConfig: GraphConfig = {
	drag: true,
	zoom: true,
	depth: 1, // Quartz default; centres the current note (see NOTE above)
	scale: 1.1,
	repelForce: 0.5,
	centerForce: 0.3,
	linkDistance: 30,
	fontSize: 0.6,
	opacityScale: 1,
	showTags: true,
	removeTags: [],
	focusOnHover: false,
	enableRadial: false
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
	enableRadial: true
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
