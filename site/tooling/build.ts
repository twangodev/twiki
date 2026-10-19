import { resolveProject } from './lib/project-config';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const site = path.resolve(import.meta.dir, '..');
const options = process.argv.slice(2);
if (options.length > 1 || options.some((value) => !['--app', '--static'].includes(value)))
	throw new Error('Use --app, --static, or no option for the complete SSR build');
if (options[0] === '--static') {
	process.env.VITE_STATIC_EXPORT = 'true';
	delete process.env.TWIKI_APP_STATIC_DIR;
	delete process.env.TWIKI_SKIP_CONTENT;
	await staticBuild();
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
		const contentRepo = resolveProject(site).root;
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
						TWIKI_APP_STATIC_DIR: path.join(temporary, 'static'),
						APPLICATION_VERSION: identity.applicationVersion
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
				TWIKI_CONTENT_REPO: contentRepo,
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

/** Static hosting has no private edition: compile and publish the public tree once. */
async function staticBuild() {
	const project = resolveProject(site);
	if (project.publication !== 'public')
		throw new Error('Static export requires publication: "public"');
	const { applicationVersion } = await import('./lib/app-version.js');
	const { contentInputFingerprint } = await import('./lib/dev-state');
	const environment = {
		...process.env,
		NODE_ENV: process.env.NODE_ENV ?? 'production',
		VITE_PUBLIC_EDITION: 'true'
	};
	const version = applicationVersion(site, environment);
	const inputs = contentInputFingerprint(project.root, version);
	const started = performance.now();
	const abort = new AbortController();
	const interrupt = () => abort.abort(new Error('Build interrupted'));
	process.on('SIGINT', interrupt);
	process.on('SIGTERM', interrupt);
	try {
		await command('bun', ['x', 'vite', 'build'], environment, abort.signal);
		if (
			applicationVersion(site, environment) !== version ||
			contentInputFingerprint(project.root, version) !== inputs
		)
			throw new Error('Source or content changed during the static build');
		const output = path.join(site, 'build/.svelte-kit/cloudflare');
		const staged = path.join(site, 'build/generated/public-site');
		rmSync(staged, { recursive: true, force: true });
		renameSync(output, staged);
		mkdirSync(output);
		renameSync(staged, path.join(output, '_published'));
		console.log(
			`build: public static export completed in ${((performance.now() - started) / 1000).toFixed(2)}s`
		);
	} finally {
		process.removeListener('SIGINT', interrupt);
		process.removeListener('SIGTERM', interrupt);
	}
}
