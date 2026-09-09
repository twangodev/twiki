import { compileContent } from './compiler';
import { prepareAssets } from './assets';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pipelineFingerprint } from './fingerprint';

const state = globalThis as typeof globalThis & {
	wisconsinContentBuilds?: Map<string, Promise<void>>;
};

export async function prepareContent(reuse = false) {
	const builds = (state.wisconsinContentBuilds ??= new Map());
	const key = JSON.stringify([
		process.cwd(),
		process.env.WISCONSIN_CONTENT_REPO,
		process.env.VITE_PUBLIC_EDITION,
		pipelineFingerprint()
	]);
	if (
		reuse &&
		process.env.WISCONSIN_PREPARED_CONTENT === key &&
		existsSync('build/generated/content-manifest.json')
	)
		return;
	if (reuse && existsSync(path.resolve('build/generated/content-manifest.json')) && builds.has(key))
		return builds.get(key);
	const build = runPipeline();
	builds.set(key, build);
	try {
		await build;
		process.env.WISCONSIN_PREPARED_CONTENT = key;
	} catch (error) {
		builds.delete(key);
		delete process.env.WISCONSIN_PREPARED_CONTENT;
		throw error;
	}
}

async function runPipeline() {
	const start = performance.now();
	await compileContent();
	await prepareAssets();
	console.log(`content pipeline: ${((performance.now() - start) / 1000).toFixed(2)}s`);
}
