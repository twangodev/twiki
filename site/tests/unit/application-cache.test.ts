import { afterEach, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	applicationCacheIdentity,
	loadApplicationCache,
	prepareApplicationStatic,
	saveApplicationCache,
	stageApplication
} from '../../tooling/lib/application-cache';

const fixtures: string[] = [];
function write(root: string, name: string, value: string) {
	const file = path.join(root, name);
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, value);
}
function fixture() {
	const site = mkdtempSync(path.join(tmpdir(), 'wisconsin-app-cache-'));
	fixtures.push(site);
	write(
		site,
		'package.json',
		JSON.stringify({ type: 'module', devDependencies: { vite: '8.0.16' } })
	);
	write(site, 'bun.lock', 'pinned dependencies');
	write(site, 'node_modules/vite/package.json', '{"version":"8.0.16"}');
	write(site, 'src/routes/+page.svelte', '<p>Application</p>');
	write(site, 'worker/index.ts', 'export default {};');
	write(site, 'static/.gitignore', '*\n!.gitignore\n!favicon.png\n!fonts/\n!fonts/**\n');
	write(site, 'static/favicon.png', 'favicon');
	write(site, 'static/fonts/font.woff2', 'font');
	for (const [file, bytes] of Object.entries({
		'worker.js': 'wrapper',
		'svelte-worker.js': 'server',
		'prepared-worker/worker.json': '{"modules":[]}',
		'application-assets.json': '{"schema":1}',
		'cloudflare/_app/client.js': 'client',
		'cloudflare/fonts/font.woff2': 'font',
		'tsconfig.json': '{"types":true}'
	}))
		write(site, `build/.svelte-kit/${file}`, bytes);
	return site;
}
afterEach(() => {
	for (const site of fixtures.splice(0)) rmSync(site, { recursive: true, force: true });
});

test('application identity ignores generated content and edition selection, but includes source, installed dependencies and compile environment', () => {
	const site = fixture();
	const identity = applicationCacheIdentity(site, { NODE_ENV: 'production' });
	write(site, 'build/generated/content-manifest.json', '{"content":"changed"}');
	write(site, 'src/lib/generated/nav.json', 'changed navigation');
	write(site, 'tooling/r-render-profile.json', '{"runtime":"changed content renderer"}');
	write(site, 'static/course/blob.bin', 'changed course asset');
	expect(
		applicationCacheIdentity(site, { NODE_ENV: 'production', VITE_PUBLIC_EDITION: 'true' }).identity
	).toBe(identity.identity);
	expect(applicationCacheIdentity(site, { NODE_ENV: 'development' }).identity).not.toBe(
		identity.identity
	);
	expect(
		applicationCacheIdentity(site, {
			NODE_ENV: 'production',
			PUBLIC_ORIGIN: 'https://changed.example'
		}).identity
	).not.toBe(identity.identity);
	write(site, 'src/routes/+page.svelte', '<p>Changed application</p>');
	const sourceChanged = applicationCacheIdentity(site, { NODE_ENV: 'production' });
	expect(sourceChanged.identity).not.toBe(identity.identity);
	write(site, 'node_modules/vite/package.json', '{"version":"8.0.17"}');
	expect(applicationCacheIdentity(site, { NODE_ENV: 'production' }).identity).not.toBe(
		sourceChanged.identity
	);
});

test('prepared application can be verified and independently staged with generated types intact', () => {
	const site = fixture();
	const identity = applicationCacheIdentity(site, {});
	const saved = saveApplicationCache(site, identity);
	expect(loadApplicationCache(site, identity)?.manifest.identity).toBe(identity.identity);
	const pointer = JSON.parse(
		readFileSync(path.join(site, 'build/generated/cache/application-current.json'), 'utf8')
	);
	expect(pointer.identity).toBe(identity.identity);
	expect(pointer.files).toContain(
		`application/${identity.identity}/kit/prepared-worker/worker.json`
	);
	const destination = path.join(site, 'build/staged-app');
	stageApplication(saved, destination);
	expect(readFileSync(path.join(destination, 'tsconfig.json'), 'utf8')).toBe('{"types":true}');
	write(destination, 'cloudflare/_app/client.js', 'staging edit');
	expect(readFileSync(path.join(saved.directory, 'kit/cloudflare/_app/client.js'), 'utf8')).toBe(
		'client'
	);
});

test('same-length cache corruption, extra files and redirected cached files fail cold', () => {
	const site = fixture();
	const identity = applicationCacheIdentity(site, {});
	let saved = saveApplicationCache(site, identity);
	write(saved.directory, 'kit/cloudflare/_app/client.js', 'CLIENT');
	expect(loadApplicationCache(site, identity)).toBeUndefined();
	saved = saveApplicationCache(site, identity);
	write(saved.directory, 'kit/extra.txt', 'unexpected');
	expect(loadApplicationCache(site, identity)).toBeUndefined();
	saved = saveApplicationCache(site, identity);
	const client = path.join(saved.directory, 'kit/cloudflare/_app/client.js');
	rmSync(client);
	symlinkSync(path.join(site, 'src/routes/+page.svelte'), client);
	expect(loadApplicationCache(site, identity)).toBeUndefined();
});

test('an application artifact cannot contain deployed course snapshots or an incomplete prepared worker', () => {
	const site = fixture();
	const identity = applicationCacheIdentity(site, {});
	write(site, 'build/.svelte-kit/cloudflare/_content/current.json', 'private content');
	expect(() => saveApplicationCache(site, identity)).toThrow('generated content');
	rmSync(path.join(site, 'build/.svelte-kit/cloudflare/_content'), { recursive: true });
	rmSync(path.join(site, 'build/.svelte-kit/prepared-worker/worker.json'));
	expect(() => saveApplicationCache(site, identity)).toThrow('incomplete');
});

test('failed app-cache replacement restores the old artifact, and preserves its backup if rollback fails', () => {
	const site = fixture();
	const identity = applicationCacheIdentity(site, {});
	const saved = saveApplicationCache(site, identity);
	const current = path.join(site, 'build/generated/cache/application-current.json');
	const pointer = readFileSync(current, 'utf8');
	write(site, 'build/.svelte-kit/cloudflare/_app/client.js', 'new client');
	const rename = fs.renameSync;
	let failRollback = false;
	const injected = spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
		if (path.basename(String(source)) === 'application' && destination === saved.directory)
			throw new Error('Injected app replacement failure');
		if (
			failRollback &&
			path.basename(String(source)) === 'previous' &&
			destination === saved.directory
		)
			throw new Error('Injected app rollback failure');
		return rename(source, destination);
	});
	try {
		expect(() => saveApplicationCache(site, identity)).toThrow('Injected app replacement failure');
		expect(loadApplicationCache(site, identity)?.manifest.identity).toBe(identity.identity);
		expect(readFileSync(current, 'utf8')).toBe(pointer);
		failRollback = true;
		expect(() => saveApplicationCache(site, identity)).toThrow('preserved for recovery');
		const parent = path.dirname(saved.directory);
		const transaction = fs
			.readdirSync(parent)
			.find((name) => name.startsWith('.application-save-'))!;
		expect(
			readFileSync(path.join(parent, transaction, 'previous/kit/cloudflare/_app/client.js'), 'utf8')
		).toBe('client');
		expect(readFileSync(current, 'utf8')).toBe(pointer);
	} finally {
		injected.mockRestore();
	}
});

test('neutral app static assets contain maintained files without generated course data', () => {
	const site = fixture();
	write(site, '.gitignore', 'build/\nnode_modules/\n');
	execFileSync('git', ['init', '-q', site]);
	execFileSync('git', ['-C', site, 'add', '.']);
	write(site, 'static/course/private.bin', 'private data');
	write(site, 'static/fonts/new.woff2', 'new maintained font');
	const destination = path.join(site, 'build/app-static');
	prepareApplicationStatic(site, destination);
	expect(existsSync(path.join(destination, 'course'))).toBe(false);
	expect(readFileSync(path.join(destination, 'fonts/new.woff2'), 'utf8')).toBe(
		'new maintained font'
	);
	expect(readFileSync(path.join(destination, 'favicon.png'), 'utf8')).toBe('favicon');
});
