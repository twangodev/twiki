import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { publicAssetManifest } from './lib/public-assets';
import { buildMode, runEditionBuilds } from './lib/edition-builds';

const site = path.resolve(import.meta.dir, '..');
const mode = buildMode();
if (mode !== 'serial') {
	await isolatedBuild(mode);
} else {
	serialBuild();
}

function serialBuild() {
	const output = path.join(site, 'build/.svelte-kit/cloudflare');
	const staged = path.join(site, 'build/generated/public-site');
	const manifestPath = path.join(site, 'build/generated/public-assets.json');
	let publicAssets: Record<string, string> = {};
	mkdirSync(path.dirname(manifestPath), { recursive: true });
	writeFileSync(manifestPath, '{}');
	rmSync(staged, { recursive: true, force: true });

	const started = performance.now();

	function build(publicEdition: boolean) {
		const started = performance.now();
		const result = spawnSync('bun', ['x', 'vite', 'build'], {
			cwd: site,
			stdio: 'inherit',
			env: {
				...process.env,
				NODE_ENV: process.env.NODE_ENV ?? 'production',
				VITE_PUBLIC_EDITION: String(publicEdition)
			}
		});
		if (result.status !== 0)
			throw new Error(`${publicEdition ? 'Public' : 'Full'} build failed`, {
				cause: result.error
			});
		console.log(
			`build: ${publicEdition ? 'public' : 'full'} completed in ${((performance.now() - started) / 1000).toFixed(2)}s`
		);
	}

	{
		build(true);
		const pages = JSON.parse(
			readFileSync(path.join(site, 'build/generated/public-routes.json'), 'utf8')
		);
		const content = JSON.parse(
			readFileSync(path.join(site, 'build/generated/content-manifest.json'), 'utf8')
		);
		for (const asset of content.htmlAssets) {
			pages[`/${asset}`] = `${asset}.html`;
			pages[`/${asset}.html`] = `${asset}.html`;
		}
		const fileEntries = JSON.parse(
			readFileSync(path.join(site, 'src/lib/generated/file-entries.json'), 'utf8')
		);
		publicAssets = publicAssetManifest(output, pages, fileEntries);
		// Both editions live on the same filesystem. Move the public tree aside
		// before the full adapter recreates its output, without copying every asset.
		renameSync(output, staged);
		console.log(
			`publishing: ${Object.keys(pages).length} public pages; ${fileEntries.length} file routes share one shell; history remains private`
		);
	}
	build(false);
	renameSync(staged, path.join(output, '_published'));
	writeFileSync(manifestPath, JSON.stringify(publicAssets));

	console.log(`build: all completed in ${((performance.now() - started) / 1000).toFixed(2)}s`);
}

async function isolatedBuild(mode: 'parallel' | 'isolated-serial') {
	const started = performance.now();
	const abort = new AbortController();
	const interrupt = () => abort.abort(new Error('Build interrupted by SIGINT'));
	const terminate = () => abort.abort(new Error('Build interrupted by SIGTERM'));
	process.on('SIGINT', interrupt);
	process.on('SIGTERM', terminate);
	let workspace:
		| { publicSite: string; fullSite: string; cleanup: () => void | Promise<void> }
		| undefined;
	let cleanupSeconds = 0;
	let succeeded = false;
	try {
		const [
			{ createBuildWorkspaces, mergeBuildCaches },
			{ assembleBuilds },
			{ applicationVersion },
			{ contentInputFingerprint }
		] = await Promise.all([
			import('./lib/build-workspace'),
			import('./lib/build-assembly'),
			import('./lib/app-version.js'),
			import('./lib/dev-state')
		]);
		const contentRepo = process.env.WISCONSIN_CONTENT_REPO ?? path.resolve(site, '..');
		const versionEnvironment: NodeJS.ProcessEnv = {
			...process.env,
			NODE_ENV: process.env.NODE_ENV ?? 'production'
		};
		delete versionEnvironment.WISCONSIN_APPLICATION_VERSION;
		const version = applicationVersion(site, versionEnvironment);
		const contentInputs = contentInputFingerprint(contentRepo, version);
		abort.signal.throwIfAborted();
		workspace = await createBuildWorkspaces(site, contentRepo);
		abort.signal.throwIfAborted();
		const benchmarks = path.join(site, 'build/benchmarks');
		mkdirSync(benchmarks, { recursive: true, mode: 0o700 });
		const logDirectory = mkdtempSync(path.join(benchmarks, 'edition-'));
		const setupSeconds = (performance.now() - started) / 1000;
		console.log(`build: ${mode} setup in ${setupSeconds.toFixed(2)}s; logs: ${logDirectory}`);
		const buildStarted = performance.now();
		const editions = await runEditionBuilds(workspace, {
			mode,
			contentRepo,
			applicationVersion: version,
			logDirectory,
			signal: abort.signal
		});
		const buildSpanSeconds = (performance.now() - buildStarted) / 1000;
		abort.signal.throwIfAborted();
		const validationStarted = performance.now();
		if (
			applicationVersion(site, versionEnvironment) !== version ||
			contentInputFingerprint(contentRepo, version) !== contentInputs
		)
			throw new Error(
				'Source or course content changed during the build; refusing to assemble mixed editions'
			);
		const validationSeconds = (performance.now() - validationStarted) / 1000;
		const mergeStarted = performance.now();
		mergeBuildCaches(
			workspace.publicSite,
			workspace.fullSite,
			path.join(workspace.fullSite, 'build/generated/cache')
		);
		const cacheMergeSeconds = (performance.now() - mergeStarted) / 1000;
		const assemblyStarted = performance.now();
		const publication = assembleBuilds(site, workspace.publicSite, workspace.fullSite);
		const assemblySeconds = (performance.now() - assemblyStarted) / 1000;
		console.log(
			`publishing: ${publication.publicPages} public pages; ${publication.fileRoutes} file routes share one shell; history remains private`
		);
		const cleanupStarted = performance.now();
		await workspace.cleanup();
		workspace = undefined;
		cleanupSeconds = (performance.now() - cleanupStarted) / 1000;
		const totalSeconds = (performance.now() - started) / 1000;
		console.log(`build: all completed in ${totalSeconds.toFixed(2)}s`);
		console.log(
			`build: metrics ${JSON.stringify({
				mode,
				setupSeconds,
				...editions,
				buildSpanSeconds,
				validationSeconds,
				cacheMergeSeconds,
				assemblySeconds,
				cleanupSeconds,
				totalSeconds,
				logs: {
					public: path.join(logDirectory, 'public.log'),
					full: path.join(logDirectory, 'full.log')
				}
			})}`
		);
		succeeded = true;
	} finally {
		if (workspace) {
			const cleanupStarted = performance.now();
			await workspace.cleanup();
			cleanupSeconds = (performance.now() - cleanupStarted) / 1000;
		}
		process.removeListener('SIGINT', interrupt);
		process.removeListener('SIGTERM', terminate);
		if (!succeeded)
			console.log(
				`build: ${mode} failed after ${((performance.now() - started) / 1000).toFixed(2)}s; cleanup ${cleanupSeconds.toFixed(2)}s`
			);
	}
}
