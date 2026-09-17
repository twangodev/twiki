import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareWranglerPaths } from '../../tooling/wrangler-paths.js';

test('moves existing local state, redirects hardcoded paths, and supports repeated setup', () => {
	const site = mkdtempSync(path.join(tmpdir(), 'wrangler-paths-'));
	try {
		mkdirSync(path.join(site, '.wrangler/state/v3'), { recursive: true });
		writeFileSync(path.join(site, '.wrangler/state/v3/database'), 'preserved');
		const target = prepareWranglerPaths(site);
		expect(prepareWranglerPaths(site)).toBe(target);
		expect(realpathSync(path.join(site, '.wrangler'))).toBe(target);
		expect(readFileSync(path.join(target, 'state/v3/database'), 'utf8')).toBe('preserved');
		writeFileSync(path.join(site, '.wrangler/new-file'), 'redirected');
		expect(readFileSync(path.join(target, 'new-file'), 'utf8')).toBe('redirected');
	} finally {
		rmSync(site, { recursive: true, force: true });
	}
});

test('refuses to overwrite a second existing state directory', () => {
	const site = mkdtempSync(path.join(tmpdir(), 'wrangler-paths-'));
	try {
		mkdirSync(path.join(site, '.wrangler'));
		mkdirSync(path.join(site, 'build/.wrangler'), { recursive: true });
		expect(() => prepareWranglerPaths(site)).toThrow('refusing to overwrite');
	} finally {
		rmSync(site, { recursive: true, force: true });
	}
});
