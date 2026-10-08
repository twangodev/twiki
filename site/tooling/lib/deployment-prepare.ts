import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
	configSha256,
	deploymentError,
	equalJSON,
	expectedBindings,
	readDeploymentConfig,
	record,
	sha256,
	type DeploymentConfig
} from './deployment-config';
import {
	SHA256,
	assetPath,
	validateAssetInventory,
	type AssetInventory
} from './deployment-manifest';

export interface PreparedModule {
	name: string;
	type: string;
	sha256: string;
	size: number;
	filename: string;
}

export interface PreparedWorker {
	schema: 1;
	configSha256: string;
	wranglerVersion: string;
	metadata: Record<string, unknown>;
	modules: PreparedModule[];
	digest: string;
}

export interface DeploymentSnapshot {
	schema: 1;
	provenance: string;
	configSha256: string;
	worker: PreparedWorker;
	inventory: AssetInventory;
}

export function workerDigest(worker: Omit<PreparedWorker, 'digest'> | PreparedWorker): string {
	return sha256(
		JSON.stringify([
			worker.schema,
			worker.configSha256,
			worker.wranglerVersion,
			worker.metadata,
			worker.modules
		])
	);
}

export function validatePreparedWorker(value: unknown, config: DeploymentConfig): PreparedWorker {
	if (
		!record(value) ||
		value.schema !== 1 ||
		value.configSha256 !== configSha256(config) ||
		typeof value.wranglerVersion !== 'string' ||
		!record(value.metadata) ||
		!Array.isArray(value.modules)
	)
		deploymentError('incompatible prepared Worker');
	const metadata = value.metadata;
	if (
		typeof metadata.main_module !== 'string' ||
		!equalJSON(metadata.compatibility_flags, config.compatibility_flags) ||
		metadata.compatibility_date !== config.compatibility_date ||
		!Array.isArray(metadata.bindings)
	)
		deploymentError('prepared Worker metadata mismatch');
	const bindings = [...metadata.bindings].sort((a, b) =>
		String(a.name).localeCompare(String(b.name))
	);
	if (
		!equalJSON(
			bindings,
			expectedBindings(config).sort((a, b) => String(a.name).localeCompare(String(b.name)))
		)
	)
		deploymentError('prepared Worker binding mismatch');
	if (!equalJSON(metadata.keep_bindings, ['secret_text', 'secret_key']))
		deploymentError('prepared Worker must preserve secrets');
	const supported = [
		'main_module',
		'bindings',
		'compatibility_date',
		'compatibility_flags',
		'keep_bindings',
		'logpush',
		'observability'
	];
	if (
		Object.keys(metadata).some((key) => !supported.includes(key)) ||
		(metadata.logpush !== undefined && metadata.logpush !== false)
	)
		deploymentError('unsupported prepared Worker metadata');
	// Wrangler normalizes observability even when it is absent from the source configuration.
	if (
		metadata.observability !== undefined &&
		(!record(metadata.observability) ||
			metadata.observability.enabled !== false ||
			Object.keys(metadata.observability).some((key) => key !== 'enabled'))
	)
		deploymentError('unsupported prepared Worker observability');
	const names = new Set<string>();
	for (const module of value.modules) {
		if (
			!record(module) ||
			typeof module.name !== 'string' ||
			!assetPath(`/${module.name}`) ||
			names.has(module.name) ||
			typeof module.sha256 !== 'string' ||
			!SHA256.test(module.sha256) ||
			module.filename !== `modules/${module.sha256}` ||
			!Number.isSafeInteger(module.size) ||
			(module.size as number) < 0 ||
			![
				'application/javascript+module',
				'application/javascript',
				'text/plain',
				'application/wasm',
				'application/octet-stream',
				'application/source-map'
			].includes(module.type as string)
		)
			deploymentError('invalid prepared Worker module');
		names.add(module.name);
	}
	if (!names.has(metadata.main_module) || !value.modules.length)
		deploymentError('prepared Worker entry module is missing');
	const worker = value as unknown as PreparedWorker;
	if (worker.digest !== workerDigest(worker)) deploymentError('prepared Worker integrity failed');
	return worker;
}

/** Parse Wrangler's actual serialized upload form; no module/default dependency inference. */
export async function capturePreparedWorker(
	multipart: Uint8Array,
	config: DeploymentConfig,
	version: string,
	outputDirectory: string
): Promise<PreparedWorker> {
	const firstLine = Buffer.from(multipart).subarray(0, 200).toString().split('\r\n')[0];
	if (!/^--[-a-zA-Z0-9]+$/.test(firstLine)) deploymentError('invalid Wrangler multipart boundary');
	// Bun's multipart parser rewrites .js part MIME types. Preserve Wrangler's exact raw headers.
	const buffer = Buffer.from(multipart);
	const boundary = Buffer.from(`\r\n${firstLine}`);
	const parts: { name: string; type: string; bytes: Uint8Array }[] = [];
	let cursor = firstLine.length + 2;
	let closed = false;
	while (cursor < buffer.length) {
		const headersEnd = buffer.indexOf('\r\n\r\n', cursor);
		if (headersEnd < 0 || headersEnd - cursor > 16_384)
			deploymentError('invalid Wrangler multipart headers');
		const headers = buffer.subarray(cursor, headersEnd).toString('utf8');
		const disposition = headers.split('\r\n').find((line) => /^Content-Disposition: /i.test(line));
		const nameMatch = disposition?.match(/; name=("(?:[^"\\]|\\.)*")/);
		if (!nameMatch) deploymentError('invalid Wrangler multipart disposition');
		let name: string;
		try {
			name = JSON.parse(nameMatch[1]);
		} catch {
			deploymentError('invalid Wrangler module name');
		}
		const type =
			headers
				.split('\r\n')
				.find((line) => /^Content-Type: /i.test(line))
				?.slice('Content-Type: '.length) ?? '';
		const bodyStart = headersEnd + 4;
		const bodyEnd = buffer.indexOf(boundary, bodyStart);
		if (bodyEnd < 0) deploymentError('invalid Wrangler multipart body');
		parts.push({ name, type, bytes: buffer.subarray(bodyStart, bodyEnd) });
		cursor = bodyEnd + boundary.length;
		if (buffer.subarray(cursor, cursor + 2).toString() === '--') {
			if (!/^--(?:\r\n)?$/.test(buffer.subarray(cursor).toString()))
				deploymentError('invalid Wrangler multipart trailer');
			closed = true;
			break;
		}
		if (buffer.subarray(cursor, cursor + 2).toString() !== '\r\n')
			deploymentError('invalid Wrangler multipart separator');
		cursor += 2;
	}
	if (!closed || parts.filter((part) => part.name === 'metadata').length !== 1)
		deploymentError('Wrangler metadata is missing');
	const rawMetadata = Buffer.from(parts.find((part) => part.name === 'metadata')!.bytes).toString(
		'utf8'
	);
	let metadata: Record<string, unknown>;
	try {
		metadata = JSON.parse(rawMetadata);
	} catch {
		deploymentError('invalid Wrangler metadata');
	}
	if (!record(metadata) || !Array.isArray(metadata.bindings))
		deploymentError('invalid Wrangler metadata');
	metadata.keep_bindings = ['secret_text', 'secret_key'];
	const modules: PreparedModule[] = [];
	const bodies = new Map<string, Uint8Array>();
	for (const { name, type, bytes } of parts) {
		if (name === 'metadata') continue;
		const digest = sha256(bytes);
		modules.push({
			name,
			type,
			sha256: digest,
			size: bytes.byteLength,
			filename: `modules/${digest}`
		});
		bodies.set(digest, bytes);
	}
	const worker: PreparedWorker = {
		schema: 1,
		configSha256: configSha256(config),
		wranglerVersion: version,
		metadata,
		modules,
		digest: ''
	};
	worker.digest = workerDigest(worker);
	validatePreparedWorker(worker, config);
	await mkdir(path.join(outputDirectory, 'modules'), { recursive: true });
	for (const [digest, body] of bodies)
		await writeFile(path.join(outputDirectory, 'modules', digest), body, { mode: 0o600 });
	await writeFile(path.join(outputDirectory, 'worker.json'), JSON.stringify(worker), {
		mode: 0o600
	});
	return worker;
}

export function verifyModuleBytes(module: PreparedModule, bytes: Uint8Array): void {
	if (bytes.byteLength !== module.size || sha256(bytes) !== module.sha256)
		deploymentError('prepared Worker module integrity failed');
}

export async function loadPreparedWorker(
	outputDirectory: string,
	config?: DeploymentConfig
): Promise<PreparedWorker> {
	const worker: PreparedWorker = JSON.parse(
		await readFile(path.join(outputDirectory, 'worker.json'), 'utf8')
	);
	// Callers normally supply config. Derivation from the site directory is only a convenience for canonical layout.
	validatePreparedWorker(
		worker,
		config ?? readDeploymentConfig(path.resolve(outputDirectory, '../../..'))
	);
	for (const module of worker.modules)
		verifyModuleBytes(module, await readFile(path.join(outputDirectory, module.filename)));
	return worker;
}

/** Offline, credential-free Wrangler build. Does not register/upload assets or call account APIs. */
export async function prepareWorker(
	siteRoot: string,
	outputDirectory: string
): Promise<PreparedWorker> {
	siteRoot = path.resolve(siteRoot);
	outputDirectory = path.resolve(outputDirectory);
	const config = readDeploymentConfig(siteRoot);
	const version = JSON.parse(
		await readFile(path.join(siteRoot, 'node_modules/wrangler/package.json'), 'utf8')
	).version;
	await mkdir(outputDirectory, { recursive: true });
	const offlineConfig = {
		...config,
		main: path.resolve(siteRoot, config.main),
		assets: { ...config.assets, directory: path.resolve(siteRoot, config.assets.directory) }
	};
	delete offlineConfig.account_id;
	// Do not load the site's dotenv files or inherit Cloudflare credentials into Wrangler's process.
	const configFile = path.join(outputDirectory, 'offline-wrangler.json');
	const multipartFile = path.join(outputDirectory, 'worker.multipart');
	await writeFile(configFile, JSON.stringify(offlineConfig), { mode: 0o600 });
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !/^(CLOUDFLARE_|CF_|WRANGLER_)/.test(key))
	);
	env.WRANGLER_SEND_METRICS = 'false';
	env.WRANGLER_LOG = 'error';
	env.WRANGLER_LOG_PATH = path.join(outputDirectory, 'wrangler.log');
	const result = spawnSync(
		process.env.NODE_BINARY ?? 'node',
		[
			path.join(siteRoot, 'node_modules/wrangler/bin/wrangler.js'),
			'deploy',
			'--config',
			configFile,
			'--dry-run',
			'--outdir',
			path.join(outputDirectory, 'wrangler'),
			'--outfile',
			multipartFile
		],
		{ cwd: outputDirectory, env, encoding: 'utf8', maxBuffer: 1024 * 1024 * 8 }
	);
	try {
		if (result.status !== 0) deploymentError('offline Wrangler preparation failed');
		return await capturePreparedWorker(
			await readFile(multipartFile),
			config,
			version,
			outputDirectory
		);
	} finally {
		await rm(configFile, { force: true });
		await rm(path.join(outputDirectory, 'wrangler.log'), { force: true });
	}
}

export function buildDeploymentSnapshot(
	worker: PreparedWorker,
	inventory: AssetInventory,
	config: DeploymentConfig,
	provenance: string
): DeploymentSnapshot {
	validatePreparedWorker(worker, config);
	validateAssetInventory(inventory, provenance);
	return { schema: 1, configSha256: configSha256(config), provenance, worker, inventory };
}
