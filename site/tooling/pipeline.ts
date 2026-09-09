import { compileContent } from './compiler';
import { prepareAssets } from './assets';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pipelineFingerprint } from './fingerprint';
import { trackOutputs, writeChanged } from './lib/output';
import { contentInputFingerprint, contentOutputFingerprint } from './lib/dev-state';

const state = globalThis as typeof globalThis & {
	wisconsinContentBuilds?: Map<string, Promise<Set<string>>>;
};

export async function prepareContent(
	reuse = false,
	changedInputs?: Set<string>,
	development = false
) {
	const builds = (state.wisconsinContentBuilds ??= new Map());
	const key = JSON.stringify([
		process.cwd(),
		process.env.WISCONSIN_CONTENT_REPO,
		process.env.VITE_PUBLIC_EDITION,
		pipelineFingerprint(),
		development
	]);
	const site = process.cwd();
	const repo = process.env.WISCONSIN_CONTENT_REPO ?? path.resolve(site, '..');
	const marker = path.resolve('build/generated/dev-state.json');
	const started = performance.now();
	let inputs = development ? contentInputFingerprint(repo, key) : '';
	if (development && reuse && existsSync(marker)) {
		try {
			const saved = JSON.parse(readFileSync(marker, 'utf8'));
			if (saved.inputs === inputs && saved.outputs === contentOutputFingerprint(site)) {
				console.log(
					`content startup: reused saved output in ${Math.round(performance.now() - started)}ms`
				);
				return new Set<string>();
			}
		} catch {
			/* Reconcile incomplete or stale generated output. */
		}
	}
	if (
		!development &&
		reuse &&
		process.env.WISCONSIN_PREPARED_CONTENT === key &&
		existsSync('build/generated/content-manifest.json')
	)
		return;
	if (
		!development &&
		reuse &&
		existsSync(path.resolve('build/generated/content-manifest.json')) &&
		builds.has(key)
	)
		return builds.get(key);
	rmSync(marker, { force: true });
	const build = runPipeline(changedInputs, development);
	builds.set(key, build);
	try {
		const changed = await build;
		if (development) {
			let current = contentInputFingerprint(repo, key);
			while (current !== inputs) {
				inputs = current;
				for (const file of await runPipeline(undefined, true)) changed.add(file);
				current = contentInputFingerprint(repo, key);
			}
			writeChanged(marker, JSON.stringify({ inputs, outputs: contentOutputFingerprint(site) }));
		}
		process.env.WISCONSIN_PREPARED_CONTENT = key;
		return changed;
	} catch (error) {
		builds.delete(key);
		delete process.env.WISCONSIN_PREPARED_CONTENT;
		throw error;
	}
}

async function runPipeline(changedInputs?: Set<string>, development = false) {
	const start = performance.now();
	const changed = await trackOutputs(async () => {
		await compileContent();
		await prepareAssets(changedInputs, development);
	});
	console.log(
		`content pipeline: ${((performance.now() - start) / 1000).toFixed(2)}s, ${changed.size} changed outputs`
	);
	return changed;
}
