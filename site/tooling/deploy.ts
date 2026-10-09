import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deploymentError, readDeploymentConfig } from './lib/deployment-config';
import {
	captureAssetInventory,
	assetPath,
	SHA256,
	readCurrentDescriptorProvenance,
	assetContentType
} from './lib/deployment-manifest';
import {
	buildDeploymentSnapshot,
	loadPreparedWorker,
	prepareWorker,
	type DeploymentSnapshot
} from './lib/deployment-prepare';
import { CloudflareDeploymentAPI, uploadDeployment } from './lib/deployment-upload';
import { captureAssetHashes, flushAssetHashCache } from './lib/asset-hash-cache';

/** No implicit network operation: --prepare is offline; --upload is an explicit production mutation. */
export async function deploymentCLI(args: string[]): Promise<void> {
	const options = new Map<string, string>();
	let mode: '--prepare' | '--upload' | undefined;
	for (let i = 0; i < args.length; i++) {
		const argument = args[i];
		if (argument === '--prepare' || argument === '--upload') {
			if (mode) deploymentError('select exactly one deployment mode');
			mode = argument;
		} else if (
			['--output', '--snapshot', '--provenance', '--site', '--worker'].includes(argument) &&
			args[i + 1] &&
			!args[i + 1].startsWith('--') &&
			!options.has(argument)
		)
			options.set(argument, args[++i]);
		else deploymentError('unsupported CLI arguments');
	}
	if (!mode) deploymentError('select --prepare or --upload explicitly');
	const site = path.resolve(options.get('--site') ?? path.resolve(import.meta.dir, '..'));
	const config = readDeploymentConfig(site);
	const provenance = await readCurrentDescriptorProvenance(
		path.resolve(site, config.assets.directory)
	);
	const requestedProvenance = options.get('--provenance');
	if (
		requestedProvenance &&
		(!SHA256.test(requestedProvenance) || requestedProvenance !== provenance)
	)
		deploymentError('explicit provenance does not match current content descriptor');
	const outputDirectory = path.resolve(
		options.get('--output') ?? path.join(site, 'build/.svelte-kit/prepared-worker')
	);
	const snapshotFile = path.resolve(
		options.get('--snapshot') ?? path.join(site, 'build/.svelte-kit/deployment.json')
	);
	if (mode === '--prepare') {
		const worker = await prepareWorker(site, outputDirectory);
		const inventory = await captureAssetInventory(
			path.resolve(site, config.assets.directory),
			provenance,
			{
				resolveAsset: async (absolute, filename) => ({
					...captureAssetHashes(site, absolute),
					contentType: assetContentType(filename)
				})
			}
		);
		flushAssetHashCache(site);
		const snapshot = buildDeploymentSnapshot(worker, inventory, config, provenance);
		await writeFile(snapshotFile, JSON.stringify(snapshot), { mode: 0o600 });
		console.log(
			`deployment: prepared ${worker.modules.length} Worker modules and ${Object.keys(inventory.assets).length} assets offline`
		);
		return;
	}
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? config.account_id;
	const token = process.env.CLOUDFLARE_API_TOKEN;
	if (!accountId || !token)
		deploymentError('explicit upload requires Cloudflare account and API credentials');
	const workerDirectory = path.resolve(options.get('--worker') ?? outputDirectory);
	const snapshot: DeploymentSnapshot = JSON.parse(await readFile(snapshotFile, 'utf8'));
	if (snapshot.inventory.assets['/_content/current.json']?.sha256 !== provenance)
		deploymentError('deployment inventory does not match current content descriptor');
	const loadedWorker = await loadPreparedWorker(workerDirectory, config);
	if (loadedWorker.digest !== snapshot.worker.digest)
		deploymentError('Worker package does not match deployment snapshot');
	await uploadDeployment(snapshot, {
		api: new CloudflareDeploymentAPI(token),
		accountId,
		expectedProvenance: provenance,
		config,
		readModule: (module) => readFile(path.join(workerDirectory, module.filename)),
		readAsset: (filename) => {
			if (!assetPath(filename)) deploymentError('invalid asset path');
			return readFile(path.join(path.resolve(site, config.assets.directory), filename.slice(1)));
		},
		log: console.log
	});
}

if (import.meta.main) {
	try {
		await deploymentCLI(process.argv.slice(2));
	} catch (error) {
		console.error(
			error instanceof Error && error.message.startsWith('deployment:')
				? error.message
				: 'deployment: local preparation or input validation failed'
		);
		process.exitCode = 1;
	}
}
