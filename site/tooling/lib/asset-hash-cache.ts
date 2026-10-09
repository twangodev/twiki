import { lstatSync, readFileSync, realpathSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { wranglerAssetHash } from './deployment-manifest';
import { sha256 } from './deployment-config';
import { writeChanged } from './output';

export const assetHashAlgorithmVersion = 'wrangler-4.100-blake3-base64-extension-v1';
export interface AssetHashes {
	hash: string;
	sha256: string;
	size: number;
}
type Record = AssetHashes & { stamp: string; extension: string };
const inventories = new Map<string, Map<string, Record>>();
const digest = /^[a-f0-9]{64}$/;
const assetDigest = /^[a-f0-9]{32}$/;
function inventory(site: string) {
	const root = path.resolve(site);
	let value = inventories.get(root);
	if (!value) {
		value = new Map();
		try {
			const saved = JSON.parse(
				readFileSync(path.join(root, 'build/generated/cache/deployment-hashes.json'), 'utf8')
			);
			if (
				saved.schema === 1 &&
				saved.algorithm === assetHashAlgorithmVersion &&
				Array.isArray(saved.entries)
			) {
				for (const [file, record] of saved.entries) {
					if (
						typeof file === 'string' &&
						file.startsWith(root + path.sep) &&
						valid(record) &&
						typeof record.stamp === 'string' &&
						typeof record.extension === 'string'
					)
						value.set(file, record);
				}
			}
		} catch {}
		inventories.set(root, value);
	}
	return value;
}
function valid(value: AssetHashes) {
	return (
		value &&
		digest.test(value.sha256) &&
		assetDigest.test(value.hash) &&
		Number.isSafeInteger(value.size) &&
		value.size >= 0
	);
}
function fileStamp(site: string, file: string) {
	const absolute = path.resolve(file);
	if (!absolute.startsWith(path.resolve(site) + path.sep) || realpathSync(absolute) !== absolute)
		throw new Error('Asset hashing requires an owned regular file');
	const stat = lstatSync(absolute, { bigint: true });
	if (!stat.isFile()) throw new Error('Asset hashing requires a regular file');
	return JSON.stringify(
		[stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].map(String)
	);
}
/** Local acceleration only. This file/stamp inventory must never be transported. */
export function cachedAssetHashes(site: string, file: string): AssetHashes | undefined {
	try {
		const absolute = path.resolve(file);
		const record = inventory(site).get(absolute);
		// Some Linux filesystems coalesce timestamp updates within a kernel tick,
		// even when stat exposes nanoseconds. Never reuse recently written files.
		const stat = lstatSync(absolute, { bigint: true });
		const newest = stat.mtimeNs > stat.ctimeNs ? stat.mtimeNs : stat.ctimeNs;
		if (BigInt(Date.now()) * 1_000_000n - newest < 1_000_000_000n) return;
		if (
			record &&
			record.extension === path.extname(absolute) &&
			record.stamp === fileStamp(site, absolute)
		)
			return { hash: record.hash, sha256: record.sha256, size: record.size };
	} catch {}
}
/** Caller has verified these hashes against an authenticated product's actual bytes. */
export function rememberVerifiedAsset(site: string, file: string, hashes: AssetHashes) {
	if (!valid(hashes)) throw new Error('Invalid verified asset hashes');
	const absolute = path.resolve(file);
	if (lstatSync(absolute).size !== hashes.size) throw new Error('Verified asset size changed');
	inventory(site).set(absolute, {
		...hashes,
		stamp: fileStamp(site, absolute),
		extension: path.extname(absolute)
	});
}
export function captureAssetHashes(site: string, file: string): AssetHashes {
	const cached = cachedAssetHashes(site, file);
	if (cached) return cached;
	const before = fileStamp(site, file);
	const bytes = readFileSync(file);
	const value = { hash: wranglerAssetHash(bytes, file), sha256: sha256(bytes), size: bytes.length };
	if (before !== fileStamp(site, file)) throw new Error('Asset changed while hashing');
	rememberVerifiedAsset(site, file, value);
	return value;
}
export function flushAssetHashCache(site: string) {
	const file = path.join(path.resolve(site), 'build/generated/cache/deployment-hashes.json');
	mkdirSync(path.dirname(file), { recursive: true });
	writeChanged(
		file,
		JSON.stringify({
			schema: 1,
			algorithm: assetHashAlgorithmVersion,
			entries: [...inventory(site)]
		})
	);
}
