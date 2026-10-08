import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { hash } from 'blake3-wasm';
import ignore from 'ignore';
import mime from 'mime';
import { deploymentError, record, sha256 } from './deployment-config';

export interface DeploymentAsset {
	hash: string;
	size: number;
	sha256: string;
	contentType: string;
}

export interface AssetInventory {
	schema: 1;
	provenance: string;
	complete: true;
	assets: Record<string, DeploymentAsset>;
	controlFiles: { _headers?: string; _redirects?: string };
	digest: string;
}

export const SHA256 = /^[0-9a-f]{64}$/;
export const ASSET_HASH = /^[0-9a-f]{32}$/;
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
export const WRANGLER_ASSET_HASH_VERSION = 'wrangler-4.100-blake3-base64-extension-v1';

export function assetPath(value: string): boolean {
	return (
		value.startsWith('/') &&
		value.length > 1 &&
		!/[\\\0\r\n]/.test(value) &&
		value
			.slice(1)
			.split('/')
			.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
	);
}

export function wranglerAssetHash(bytes: Uint8Array, filename: string): string {
	// Matches Wrangler 4.100.0 hashFile: BLAKE3(base64(contents) + extension), first 128 bits.
	return hash(Buffer.from(bytes).toString('base64') + path.extname(filename).slice(1))
		.toString('hex')
		.slice(0, 32);
}

export function assetContentType(filename: string): string {
	const type = mime.getType(filename);
	return type?.startsWith('text/') ? `${type}; charset=utf-8` : (type ?? 'application/null');
}

export function deploymentAsset(bytes: Uint8Array, filename: string): DeploymentAsset {
	if (!assetPath(filename) || bytes.byteLength > MAX_ASSET_BYTES)
		deploymentError('invalid asset product');
	return {
		hash: wranglerAssetHash(bytes, filename),
		size: bytes.byteLength,
		sha256: sha256(bytes),
		contentType: assetContentType(filename)
	};
}

export function createAssetInventory(
	assets: Record<string, DeploymentAsset>,
	provenance: string,
	controlFiles: AssetInventory['controlFiles'] = {}
): AssetInventory {
	const inventory: AssetInventory = {
		schema: 1,
		complete: true,
		provenance,
		assets,
		controlFiles,
		digest: ''
	};
	inventory.digest = inventoryDigest(inventory);
	return validateAssetInventory(inventory, provenance);
}

export interface VerifiedInventoryMerge {
	pieces: { owner: string; inventory: AssetInventory }[];
	/** Exact identity and inventory digest from the current authenticated product manifest. */
	expectedProducts: Record<string, { provenance: string; digest: string }>;
	/** Complete current output ledger, including precedence decisions for overlapping products. */
	ownership: Record<string, { owner: string; sha256: string; size: number }>;
	provenance: string;
	controlFiles: AssetInventory['controlFiles'];
}

/**
 * Reuse hashes only from verified product inventories, never from file timestamps alone.
 * The caller must authenticate expectedProducts and the complete current ownership ledger.
 * Missing/revoked products and stale byte identities fail closed. No filesystem reads occur.
 */
export function mergeVerifiedInventories(input: VerifiedInventoryMerge): AssetInventory {
	const products = new Map<string, AssetInventory>();
	for (const { owner, inventory } of input.pieces) {
		const expected = input.expectedProducts[owner];
		if (!expected || products.has(owner) || inventory.digest !== expected.digest)
			deploymentError('unexpected product inventory');
		products.set(owner, validateAssetInventory(inventory, expected.provenance));
	}
	if (products.size !== Object.keys(input.expectedProducts).length)
		deploymentError('missing product inventory');
	const assets: Record<string, DeploymentAsset> = Object.create(null);
	for (const [filename, source] of Object.entries(input.ownership)) {
		if (!assetPath(filename) || !SHA256.test(source.sha256) || !Number.isSafeInteger(source.size))
			deploymentError('invalid ownership ledger');
		const asset = products.get(source.owner)?.assets[filename];
		if (!asset || asset.sha256 !== source.sha256 || asset.size !== source.size)
			deploymentError('product inventory does not cover current output');
		assets[filename] = asset;
	}
	return createAssetInventory(assets, input.provenance, input.controlFiles);
}

export function inventoryDigest(
	inventory: Pick<AssetInventory, 'provenance' | 'assets' | 'controlFiles'>
): string {
	return sha256(
		JSON.stringify([
			inventory.provenance,
			Object.entries(inventory.assets).sort(([a], [b]) => a.localeCompare(b)),
			inventory.controlFiles._headers ?? null,
			inventory.controlFiles._redirects ?? null
		])
	);
}

export function validateAssetInventory(value: unknown, expectedProvenance: string): AssetInventory {
	if (
		!record(value) ||
		value.schema !== 1 ||
		value.complete !== true ||
		value.provenance !== expectedProvenance ||
		!SHA256.test(expectedProvenance) ||
		!record(value.assets) ||
		!record(value.controlFiles)
	)
		deploymentError('stale or incomplete asset inventory');
	if (
		Object.keys(value.controlFiles).some((key) => !['_headers', '_redirects'].includes(key)) ||
		Object.values(value.controlFiles).some((v) => typeof v !== 'string')
	)
		deploymentError('invalid asset control files');
	for (const [filename, asset] of Object.entries(value.assets)) {
		if (
			!assetPath(filename) ||
			!record(asset) ||
			typeof asset.hash !== 'string' ||
			!ASSET_HASH.test(asset.hash) ||
			typeof asset.sha256 !== 'string' ||
			!SHA256.test(asset.sha256) ||
			!Number.isSafeInteger(asset.size) ||
			(asset.size as number) < 0 ||
			(asset.size as number) > MAX_ASSET_BYTES ||
			typeof asset.contentType !== 'string' ||
			/[\r\n]/.test(asset.contentType) ||
			asset.contentType !== assetContentType(filename)
		)
			deploymentError('invalid asset inventory');
		if (
			filename === '/_headers' ||
			filename === '/_redirects' ||
			filename === '/.assetsignore' ||
			filename === '/_worker.js'
		)
			deploymentError('invalid asset inventory control entry');
	}
	const inventory = value as unknown as AssetInventory;
	if (inventory.digest !== inventoryDigest(inventory))
		deploymentError('asset inventory integrity failed');
	return inventory;
}

export function verifyAssetBytes(
	filename: string,
	asset: DeploymentAsset,
	bytes: Uint8Array
): void {
	if (
		bytes.byteLength !== asset.size ||
		sha256(bytes) !== asset.sha256 ||
		wranglerAssetHash(bytes, filename) !== asset.hash
	)
		deploymentError('asset body integrity failed');
}

export function currentDescriptorProvenance(bytes: Uint8Array): string {
	let descriptor: unknown;
	try {
		descriptor = JSON.parse(Buffer.from(bytes).toString('utf8'));
	} catch {
		deploymentError('invalid current content descriptor');
	}
	if (
		!record(descriptor) ||
		descriptor.schemaVersion !== 1 ||
		typeof descriptor.applicationVersion !== 'string' ||
		!SHA256.test(descriptor.applicationVersion) ||
		!record(descriptor.snapshots) ||
		typeof descriptor.snapshots.public !== 'string' ||
		!SHA256.test(descriptor.snapshots.public) ||
		typeof descriptor.snapshots.full !== 'string' ||
		!SHA256.test(descriptor.snapshots.full)
	)
		deploymentError('invalid current content descriptor');
	return sha256(bytes);
}

export async function readCurrentDescriptorProvenance(assetDirectory: string): Promise<string> {
	return currentDescriptorProvenance(
		await readFile(path.join(assetDirectory, '_content/current.json'))
	);
}

/** Always hashes actual bytes. A restored authenticated inventory may be reused by its product provenance. */
export async function captureAssetInventory(
	assetDirectory: string,
	provenance: string,
	options: {
		resolveAsset?: (absoluteFilename: string, assetPath: string) => Promise<DeploymentAsset>;
	} = {}
): Promise<AssetInventory> {
	if (!SHA256.test(provenance)) deploymentError('invalid inventory provenance');
	const controlFiles: AssetInventory['controlFiles'] = {};
	for (const filename of ['_headers', '_redirects'] as const) {
		try {
			if (!(await lstat(path.join(assetDirectory, filename))).isFile())
				deploymentError('invalid asset control file');
			controlFiles[filename] = await readFile(path.join(assetDirectory, filename), 'utf8');
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
	}
	let patterns = '';
	try {
		if (!(await lstat(path.join(assetDirectory, '.assetsignore'))).isFile())
			deploymentError('invalid asset ignore file');
		patterns = await readFile(path.join(assetDirectory, '.assetsignore'), 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
	const ignorer = ignore().add([
		'/.assetsignore',
		'/_headers',
		'/_redirects',
		...patterns.split('\n')
	]);
	const assets: Record<string, DeploymentAsset> = Object.create(null);
	async function visit(directory: string, prefix: string): Promise<void> {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const relative = `${prefix}${entry.name}`;
			if (ignorer.test(relative).ignored) continue;
			if (entry.isSymbolicLink()) deploymentError('asset symlinks are unsupported');
			if (entry.isDirectory()) await visit(path.join(directory, entry.name), `${relative}/`);
			else if (entry.isFile()) {
				const filename = `/${relative}`;
				if (!assetPath(filename) || relative === '_worker.js')
					deploymentError('invalid asset path');
				if (options.resolveAsset)
					assets[filename] = await options.resolveAsset(path.join(directory, entry.name), filename);
				else
					assets[filename] = deploymentAsset(
						await readFile(path.join(directory, entry.name)),
						filename
					);
			} else deploymentError('unsupported asset file');
		}
	}
	await visit(assetDirectory, '');
	return createAssetInventory(assets, provenance, controlFiles);
}
