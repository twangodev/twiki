import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
	cachedAssetHashes,
	captureAssetHashes,
	flushAssetHashCache
} from '../../tooling/lib/asset-hash-cache';

test('asset cache detects edits and never accepts a redirected source', async () => {
	const site = mkdtempSync(path.join(tmpdir(), 'wisconsin-asset-hashes-'));
	try {
		const file = path.join(site, 'note.json');
		writeFileSync(file, 'first');
		const old = captureAssetHashes(site, file);
		expect(cachedAssetHashes(site, file)).toBeUndefined();
		await Bun.sleep(1100);
		expect(cachedAssetHashes(site, file)).toEqual(old);
		flushAssetHashCache(site);
		writeFileSync(file, 'other'); // Equal length must still invalidate the old product.
		expect(cachedAssetHashes(site, file)).toBeUndefined();
		const next = captureAssetHashes(site, file);
		expect(next.sha256).not.toBe(old.sha256);
		expect(next.hash).not.toBe(old.hash);
		const link = path.join(site, 'link.json');
		symlinkSync(file, link);
		expect(() => captureAssetHashes(site, link)).toThrow('regular file');
	} finally {
		rmSync(site, { recursive: true, force: true });
	}
});

test('Cloudflare asset identity includes extension even for identical bytes', () => {
	const site = mkdtempSync(path.join(tmpdir(), 'wisconsin-asset-extension-'));
	try {
		const json = path.join(site, 'note.json');
		const text = path.join(site, 'note.txt');
		writeFileSync(json, 'identical');
		writeFileSync(text, 'identical');
		const left = captureAssetHashes(site, json);
		const right = captureAssetHashes(site, text);
		expect(left.sha256).toBe(right.sha256);
		expect(left.hash).not.toBe(right.hash);
	} finally {
		rmSync(site, { recursive: true, force: true });
	}
});
