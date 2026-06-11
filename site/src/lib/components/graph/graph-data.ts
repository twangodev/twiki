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

/** Precomputed adjacency + degree for the full graph. */
export interface GraphIndex {
	nodes: Map<string, GraphNode>;
	/** Undirected adjacency (both directions of every link). */
	neighbors: Map<string, Set<string>>;
	/** Undirected degree (number of distinct neighbors). */
	degree: Map<string, number>;
}

export function buildIndex(data: GraphData): GraphIndex {
	const nodes = new Map<string, GraphNode>();
	const neighbors = new Map<string, Set<string>>();
	for (const n of data.nodes) {
		nodes.set(n.id, n);
		neighbors.set(n.id, new Set());
	}
	for (const l of data.links) {
		neighbors.get(l.source)?.add(l.target);
		neighbors.get(l.target)?.add(l.source);
	}
	const degree = new Map<string, number>();
	for (const [id, set] of neighbors) degree.set(id, set.size);
	return { nodes, neighbors, degree };
}

/** Node ids within `depth` hops of `start` (inclusive), undirected BFS. */
export function neighborhood(index: GraphIndex, start: string, depth: number): Set<string> {
	const seen = new Set<string>([start]);
	let frontier = [start];
	for (let d = 0; d < depth && frontier.length > 0; d++) {
		const next: string[] = [];
		for (const id of frontier) {
			for (const nb of index.neighbors.get(id) ?? []) {
				if (!seen.has(nb)) {
					seen.add(nb);
					next.push(nb);
				}
			}
		}
		frontier = next;
	}
	return seen;
}

/** Course key for a node (top-level directory), '' for root pages and home. */
export function courseOf(id: string): string {
	const i = id.indexOf('/');
	return i > 0 ? id.slice(0, i) : '';
}

/** Display-form node id → site href (SvelteKit route, trailingSlash 'never'). */
export function hrefForId(id: string): string {
	if (id === '/' || id === '') return '/';
	return `/${id.replace(/\/+$/, '')}`;
}

/**
 * Current pathname → graph node id, or undefined when the route has no node
 * (generated folder listings, /tags pages, 404).
 */
export function idForRoute(pathname: string, index: GraphIndex): string | undefined {
	const route = decodeURIComponent(pathname).replace(/^\/+|\/+$/g, '');
	if (route === '') return index.nodes.has('/') ? '/' : undefined;
	if (index.nodes.has(route)) return route;
	if (index.nodes.has(`${route}/`)) return `${route}/`; // folder index page
	return undefined;
}

/**
 * Deterministic per-course colors (AutoTag clustering). Hues are spread with
 * the golden angle over the sorted course list so adjacent courses stay
 * visually distinct; oklch keeps similar perceived lightness in both themes.
 * Root pages ('' course) use the muted token; the current node is always
 * accent red (handled in GraphView).
 */
export function courseColors(index: GraphIndex): Map<string, string> {
	const courses = [...new Set([...index.nodes.keys()].map(courseOf))].filter(Boolean).sort();
	const colors = new Map<string, string>();
	colors.set('', 'var(--color-muted, #9ca3af)');
	courses.forEach((course, i) => {
		const hue = Math.round((i * 137.508 + 30) % 360);
		colors.set(course, `oklch(0.62 0.13 ${hue})`);
	});
	return colors;
}
