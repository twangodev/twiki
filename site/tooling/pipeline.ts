import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { stageFingerprint } from './fingerprint';
import { trackOutputs, writeChanged } from './lib/output';
import { restoreDevelopmentOutputs } from './lib/dev-output-state';
import {
	captureContentBodyValidation,
	restoreContentBodyValidation,
	captureContentDocumentValidation,
	restoreContentDocumentValidation
} from './lib/content-cache';
import {
	captureContentInputs,
	captureContentOutputs,
	type ContentInputSnapshot
} from './lib/dev-state';
import {
	resolveProject,
	projectIdentity,
	writeProjectSiteConfig,
	withSourceDiscovery
} from './lib/project-config';
import type { OutputCheckpoint } from './lib/output-checkpoint';

const state = globalThis as typeof globalThis & {
	wisconsinContentBuilds?: Map<string, Promise<Set<string>>>;
};

let validatedInputs: ContentInputSnapshot | undefined;
let validatedOutputs: { key: string; checkpoint: OutputCheckpoint } | undefined;

export async function prepareContent(
	reuse = false,
	changedInputs?: Set<string>,
	development = false
) {
	return withSourceDiscovery(async () => {
		try {
			return await prepareSnapshot(reuse, changedInputs, development);
		} catch (error) {
			validatedInputs = undefined;
			validatedOutputs = undefined;
			throw error;
		}
	});
}

async function prepareSnapshot(
	reuse: boolean,
	changedInputs: Set<string> | undefined,
	development: boolean
) {
	const builds = (state.wisconsinContentBuilds ??= new Map());
	const site = process.cwd();
	const project = resolveProject(site);
	const repo = project.root;
	const preparationStarted = performance.now();
	writeProjectSiteConfig(site, project);
	const key = JSON.stringify([
		process.cwd(),
		projectIdentity(project),
		process.env.VITE_PUBLIC_EDITION,
		await stageFingerprint('pipeline'),
		development,
		development ? 'request-time-rmd-v1' : undefined
	]);
	const marker = path.resolve('build/generated/dev-state.json');
	const cache = path.resolve('build/generated/cache');
	const edition = process.env.VITE_PUBLIC_EDITION === 'true' ? 'public' : 'full';
	const started = performance.now();
	// Hints can seed an already-required rebuild; accepting saved output always
	// starts from a full capture, and every build still finishes with a fresh one.
	const snapshot = development
		? (!reuse && validatedInputs?.refresh(project, key, changedInputs)) ||
			(await captureContentInputs(repo, key))
		: undefined;
	let inputs = snapshot?.fingerprint ?? '';
	if (development)
		console.log(`content inputs: ${Math.round(performance.now() - preparationStarted)}ms`);
	if (development && reuse && existsSync(marker)) {
		try {
			const saved = JSON.parse(readFileSync(marker, 'utf8'));
			const outputs = saved.inputs === inputs ? captureContentOutputs(site) : undefined;
			if (snapshot && outputs && saved.outputs === outputs.fingerprint) {
				snapshot.withDiscovery(() => restoreDevelopmentOutputs(site, project, outputs));
				restoreContentBodyValidation(cache, edition, saved.bodies);
				restoreContentDocumentValidation(cache, site, edition, saved.documents, outputs.files);
				validatedInputs = snapshot;
				validatedOutputs = { key, checkpoint: outputs.checkpoint };
				process.env.TWIKI_PREPARED_CONTENT_KEY = key;
				console.log(
					`content startup: reused saved output in ${Math.round(performance.now() - started)}ms`
				);
				return new Set<string>();
			}
			if (outputs) validatedOutputs = undefined;
		} catch {
			validatedOutputs = undefined;
			/* Reconcile incomplete or stale generated output. */
		}
	}
	if (
		!development &&
		reuse &&
		process.env.TWIKI_PREPARED_CONTENT_KEY === key &&
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
	const changed = new Set<string>();
	let checkpoint =
		development && validatedOutputs?.key === key ? validatedOutputs.checkpoint : undefined;
	validatedOutputs = undefined;
	// A changed renderer or configuration must reconcile all courses, including unchanged worksheets.
	const run = () =>
		runPipeline(
			development && process.env.TWIKI_PREPARED_CONTENT_KEY !== key ? undefined : changedInputs,
			development,
			changed,
			checkpoint
		);
	const build = snapshot ? snapshot.withDiscovery(run) : run();
	builds.set(key, build);
	try {
		let pending = build;
		while (true) {
			let failed = false;
			let failure: unknown;
			try {
				await pending;
			} catch (error) {
				failed = true;
				failure = error;
			}
			if (!development) {
				if (failed) throw failure;
				break;
			}
			// A missed deletion can fail a candidate pass before validation. Retry
			// only when fresh inputs changed; genuine errors remain fail-closed.
			const current = await withSourceDiscovery(() => captureContentInputs(repo, key));
			if (current.fingerprint === inputs) {
				if (failed) throw failure;
				validatedInputs = current;
				checkpoint = checkpoint?.complete ? checkpoint : captureContentOutputs(site).checkpoint;
				writeChanged(
					marker,
					JSON.stringify({
						inputs,
						outputs: checkpoint.fingerprint(),
						bodies: captureContentBodyValidation(cache, edition),
						documents: captureContentDocumentValidation(cache, site, edition)
					})
				);
				validatedOutputs = { key, checkpoint };
				break;
			}
			inputs = current.fingerprint;
			checkpoint = undefined;
			pending = current.withDiscovery(() => runPipeline(undefined, true, changed));
			builds.set(key, pending);
		}
		process.env.TWIKI_PREPARED_CONTENT_KEY = key;
		return changed;
	} catch (error) {
		builds.delete(key);
		delete process.env.TWIKI_PREPARED_CONTENT_KEY;
		throw error;
	}
}

async function runPipeline(
	changedInputs?: Set<string>,
	development = false,
	outputs = new Set<string>(),
	checkpoint?: OutputCheckpoint
) {
	const start = performance.now();
	// A saved development snapshot does not need the parser or asset renderers.
	const [{ compileContent }, { prepareAssets }, { withPublicationPolicies }] = await Promise.all([
		import('./compiler'),
		import('./assets'),
		import('./lib/publishing')
	]);
	const changed = await withPublicationPolicies(() =>
		trackOutputs(
			async () => {
				const compiled = performance.now();
				const manifest = await compileContent({ development, changedInputs });
				const assets = performance.now();
				await prepareAssets(changedInputs, development, manifest);
				if (development)
					console.log(
						`content stages: compiler ${Math.round(assets - compiled)}ms, assets ${Math.round(performance.now() - assets)}ms`
					);
			},
			outputs,
			checkpoint
		)
	);
	console.log(
		`content pipeline: ${((performance.now() - start) / 1000).toFixed(2)}s, ${changed.size} changed outputs`
	);
	return changed;
}
