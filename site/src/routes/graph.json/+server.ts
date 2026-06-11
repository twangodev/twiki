import { getManifest } from '$lib/server/content';

// Prerendered to a static `/graph.json` (~275 kB raw, ~50 kB gzipped on the
// wire). Fetched lazily by the graph island (src/lib/components/graph) —
// keeps graph data out of every page's payload and out of the JS bundle.
export const prerender = true;

export function GET(): Response {
	return new Response(JSON.stringify(getManifest().graph), {
		headers: { 'content-type': 'application/json' }
	});
}
