import { readFileSync } from 'node:fs';

/** Read the active deployment inventory, never legacy outputs left by static builds. */
export function runtimeSnapshot(edition: 'public' | 'full' = 'public') {
	const descriptor: {
		schemaVersion: number;
		applicationVersion: string;
		snapshots: Record<'public' | 'full', string>;
	} = JSON.parse(readFileSync('build/.svelte-kit/cloudflare/_content/current.json', 'utf8'));
	const directory = `build/.svelte-kit/cloudflare/_content/${edition}/${descriptor.snapshots[edition]}`;
	const routing: {
		schemaVersion: number;
		routes: string[];
		assets: Record<string, string>;
	} = JSON.parse(readFileSync(`${directory}/routing.json`, 'utf8'));
	return { descriptor, directory, routing };
}
