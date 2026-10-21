import { afterEach, expect, test } from 'bun:test';
import {
	invalidateGraph,
	loadGraph,
	onGraphInvalidated
} from '../../src/lib/components/graph/graph-data';
afterEach(invalidateGraph);
const graph = { nodes: [], links: [] };
const fetcher = (async () => Response.json(graph)) as typeof fetch;
test('shares requests within a version and refetches across versions', async () => {
	const first = loadGraph(fetcher, 'a');
	expect(loadGraph(fetcher, 'a')).toBe(first);
	expect(loadGraph(fetcher, 'b')).not.toBe(first);
	await first;
});
for (const failure of [
	() => Promise.reject(new Error('offline')),
	() => Promise.resolve(new Response('', { status: 503 })),
	() => Promise.resolve(new Response('{'))
]) {
	test('retries failed requests and decoding', async () => {
		await expect(loadGraph(failure as typeof fetch)).rejects.toThrow();
		expect(await loadGraph(fetcher)).toEqual(graph);
	});
}
test('old failure cannot evict a newer version', async () => {
	let reject!: (e: Error) => void;
	const old = loadGraph(
		(() =>
			new Promise<Response>((_, fail) => {
				reject = fail;
			})) as typeof fetch,
		'old'
	);
	await Promise.resolve();
	const current = loadGraph(fetcher, 'new');
	reject(new Error('old failure'));
	await expect(old).rejects.toThrow();
	expect(loadGraph(undefined, 'new')).toBe(current);
	await current;
});
test('invalidation clears cache and unsubscribes listeners', async () => {
	let notifications = 0;
	const unsubscribe = onGraphInvalidated(() => notifications++);
	const first = loadGraph(fetcher);
	invalidateGraph();
	expect(loadGraph(fetcher)).not.toBe(first);
	expect(notifications).toBe(1);
	unsubscribe();
	invalidateGraph();
	expect(notifications).toBe(1);
	await first;
});
