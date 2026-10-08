import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { publicAssetManifest } from './lib/public-assets';
import { buildMode, runEditionBuilds } from './lib/edition-builds';

const site = path.resolve(import.meta.dir, '..');
const options = process.argv.slice(2);
if (
	options.length > 1 ||
	options.some((value) => !['--app', '--content', '--static'].includes(value))
)
	throw new Error('Use --app, --content, --static, or no option for the complete SSR build');
if (options[0] === '--static') {
	process.env.VITE_STATIC_EXPORT = 'true';
	delete process.env.WISCONSIN_APP_STATIC_DIR;
	delete process.env.WISCONSIN_SKIP_CONTENT;
	const mode = buildMode();
	if (mode !== 'serial') await isolatedBuild(mode);
	else serialBuild();
} else await runtimeBuild(options[0] === '--app');

async function command(
	binary: string,
	args: string[],
	environment: NodeJS.ProcessEnv,
	signal: AbortSignal
) {
	signal.throwIfAborted();
	const child = spawn(binary, args, {
		cwd: site,
		env: environment,
		stdio: 'inherit',
		detached: process.platform !== 'win32'
	});
	let stopping: Promise<void> | undefined;
	const stop = () => {
		if (stopping || !child.pid) return;
		const send = (kind: NodeJS.Signals) => {
			try {
				if (process.platform === 'win32') child.kill(kind);
				else process.kill(-child.pid!, kind);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
			}
		};
		send('SIGTERM');
		stopping = new Promise((resolve) =>
			setTimeout(() => {
				send('SIGKILL');
				resolve();
			}, 2000)
		);
	};
	signal.addEventListener('abort', stop, { once: true });
	try {
		await new Promise<void>((resolve, reject) => {
			child.once('error', reject);
			child.once('close', (code, killed) =>
				code === 0 ? resolve() : reject(new Error(`Build command failed (${code ?? killed})`))
			);
		});
	} finally {
		await stopping;
		signal.removeEventListener('abort', stop);
	}
	signal.throwIfAborted();
}

async function runtimeBuild(appOnly: boolean) {
	const started = performance.now();
	const abort = new AbortController();
	const interrupt = () => abort.abort(new Error('Build interrupted'));
	process.on('SIGINT', interrupt);
	process.on('SIGTERM', interrupt);
	let staging: string | undefined;
	try {
		const app = await import('./lib/application-cache');
		const { captureAssetInventory, assetContentType, validateAssetInventory } =
			await import('./lib/deployment-manifest');
		const { captureAssetHashes, flushAssetHashCache } = await import('./lib/asset-hash-cache');
		const { prepareWorker, loadPreparedWorker, buildDeploymentSnapshot } =
			await import('./lib/deployment-prepare');
		const { readDeploymentConfig } = await import('./lib/deployment-config');
		const packaging = await import('./lib/runtime-packaging');
		const { contentInputFingerprint } = await import('./lib/dev-state');
		const environment = app.applicationEnvironment();
		const identity = app.applicationCacheIdentity(site, environment);
		const contentRepo = process.env.WISCONSIN_CONTENT_REPO ?? path.resolve(site, '..');
		const contentInputs = appOnly ? '' : contentInputFingerprint(contentRepo, identity.identity);
		let cached = app.loadApplicationCache(site, identity);
		if (cached)
			try {
				validateAssetInventory(
					JSON.parse(
						readFileSync(path.join(cached.directory, 'kit/application-assets.json'), 'utf8')
					),
					identity.identity
				);
			} catch {
				cached = undefined;
			}
		const appStarted = performance.now();
		if (!cached) {
			mkdirSync(path.join(site, 'build'), { recursive: true });
			const temporary = mkdtempSync(path.join(site, 'build/.application-build-'));
			const previous = path.join(temporary, 'previous');
			const output = path.join(site, 'build/.svelte-kit');
			let moved = false,
				preserve = false;
			try {
				app.prepareApplicationStatic(site, path.join(temporary, 'static'));
				try {
					renameSync(output, previous);
					moved = true;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
				}
				await command(
					'bun',
					['x', 'vite', 'build'],
					{
						...environment,
						WISCONSIN_APP_STATIC_DIR: path.join(temporary, 'static'),
						WISCONSIN_APPLICATION_VERSION: identity.applicationVersion
					},
					abort.signal
				);
				await prepareWorker(site, path.join(output, 'prepared-worker'));
				const inventory = await captureAssetInventory(
					path.join(output, 'cloudflare'),
					identity.identity,
					{
						resolveAsset: async (absolute, filename) => ({
							...captureAssetHashes(site, absolute),
							contentType: assetContentType(filename)
						})
					}
				);
				writeFileSync(path.join(output, 'application-assets.json'), JSON.stringify(inventory));
				if (app.applicationCacheIdentity(site, environment).identity !== identity.identity)
					throw new Error('Application inputs changed during compilation');
				cached = app.saveApplicationCache(site, identity);
			} finally {
				rmSync(output, { recursive: true, force: true });
				if (moved)
					try {
						renameSync(previous, output);
					} catch (error) {
						preserve = true;
						throw new Error('Previous application output preserved for recovery', { cause: error });
					}
				if (!preserve) rmSync(temporary, { recursive: true, force: true });
			}
			console.log(
				`build: application compiled in ${((performance.now() - appStarted) / 1000).toFixed(2)}s`
			);
		} else
			console.log(
				`build: application reused in ${((performance.now() - appStarted) / 1000).toFixed(2)}s`
			);
		abort.signal.throwIfAborted();
		if (appOnly) {
			flushAssetHashCache(site);
			console.log(`build: app completed in ${((performance.now() - started) / 1000).toFixed(2)}s`);
			return;
		}
		mkdirSync(path.join(site, 'build'), { recursive: true });
		staging = mkdtempSync(path.join(site, 'build/.runtime-build-'));
		const product = path.join(staging, 'kit');
		app.stageApplication(cached!, product);
		const appInventory = validateAssetInventory(
			JSON.parse(readFileSync(path.join(product, 'application-assets.json'), 'utf8')),
			identity.identity
		);
		const editions: import('./lib/runtime-packaging').CapturedEdition[] = [];
		for (const edition of ['public', 'full'] as const) {
			const editionStarted = performance.now();
			const selected = {
				...environment,
				WISCONSIN_CONTENT_REPO: contentRepo,
				VITE_PUBLIC_EDITION: String(edition === 'public')
			};
			await command('bun', ['tooling/prepare.ts'], selected, abort.signal);
			const search = path.join(staging, `search-${edition}`);
			await command('node', ['tooling/search.js', search], selected, abort.signal);
			editions.push(
				packaging.captureRuntimeEdition(site, edition, path.join(staging, edition), search)
			);
			console.log(
				`build: ${edition} content completed in ${((performance.now() - editionStarted) / 1000).toFixed(2)}s`
			);
		}
		if (
			app.applicationCacheIdentity(site, environment).identity !== identity.identity ||
			contentInputFingerprint(contentRepo, identity.identity) !== contentInputs
		)
			throw new Error(
				'Source or course content changed during the build; refusing mixed snapshots'
			);
		abort.signal.throwIfAborted();
		const packed = packaging.packageRuntime(
			site,
			path.join(product, 'cloudflare'),
			identity.applicationVersion,
			editions,
			appInventory
		);
		const config = readDeploymentConfig(site);
		const worker = await loadPreparedWorker(path.join(product, 'prepared-worker'), config);
		writeFileSync(
			path.join(product, 'deployment.json'),
			JSON.stringify(buildDeploymentSnapshot(worker, packed.inventory, config, packed.provenance))
		);
		if (
			app.applicationCacheIdentity(site, environment).identity !== identity.identity ||
			contentInputFingerprint(contentRepo, identity.identity) !== contentInputs
		)
			throw new Error(
				'Source or course content changed during packaging; refusing mixed snapshots'
			);
		abort.signal.throwIfAborted();
		packaging.promoteRuntimeProduct(site, product);
		flushAssetHashCache(site);
		console.log(
			`publishing: ${packed.publicRoutes} public SSR routes; edition data remains private`
		);
		console.log(`build: all completed in ${((performance.now() - started) / 1000).toFixed(2)}s`);
	} finally {
		if (staging) rmSync(staging, { recursive: true, force: true });
		process.removeListener('SIGINT', interrupt);
		process.removeListener('SIGTERM', interrupt);
	}
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
