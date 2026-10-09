import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applicationVersion } from '../../tooling/lib/app-version.js';

const fixtures: string[] = [];
function fixture() {
	const site = mkdtempSync(path.join(tmpdir(), 'wisconsin-app-version-'));
	fixtures.push(site);
	write(site, 'src/routes/+page.svelte', '<p>Hello</p>');
	write(site, 'bun.lock', 'locked dependencies');
	write(site, 'static/.gitignore', '*\n!.gitignore\n!favicon.png\n!fonts/\n!fonts/**\n');
	write(site, 'static/favicon.png', 'maintained icon');
	return site;
}
function write(site: string, file: string, value: string) {
	mkdirSync(path.dirname(path.join(site, file)), { recursive: true });
	writeFileSync(path.join(site, file), value);
}
afterEach(() => {
	for (const site of fixtures.splice(0)) rmSync(site, { recursive: true, force: true });
});

test('application version is portable and identical in a Git-free scratch copy', () => {
	const first = fixture();
	const second = fixture();
	execFileSync('git', ['init', '-q', first]);
	expect(applicationVersion(first, {})).toBe(applicationVersion(second, {}));
});

test('content, generated catalogs, synced static assets, and edition do not change the version', () => {
	const site = fixture();
	const initial = applicationVersion(site, { VITE_PUBLIC_EDITION: 'true' });
	write(site, 'src/lib/generated/nav.json', '[{"title":"New note"}]');
	write(site, 'src/lib/generated/file-icons.json', '{"files":{"new.cpp":"cpp"}}');
	write(site, 'build/generated/content-manifest.json', '{"pages":{"new":{}}}');
	write(site, 'static/course/note.png', 'new course image');
	write(site, 'content/course/note.md', 'new note');
	expect(applicationVersion(site, { VITE_PUBLIC_EDITION: 'false' })).toBe(initial);
});

test('application source, dependency lock, maintained assets, and environment invalidate the version', () => {
	const site = fixture();
	let previous = applicationVersion(site, {});
	for (const [file, contents] of [
		['src/routes/+page.svelte', '<p>Changed</p>'],
		['bun.lock', 'updated dependencies'],
		['static/favicon.png', 'updated icon'],
		['.env.production', 'VITE_ORIGIN=https://example.com'],
		['.env.development', 'VITE_ORIGIN=https://development.example.com'],
		['.env.development.local', 'VITE_ORIGIN=https://local-development.example.com'],
		['.env.test', 'VITE_ORIGIN=https://test.example.com'],
		['.env.test.local', 'VITE_ORIGIN=https://local-test.example.com']
	]) {
		write(site, file, contents);
		const current = applicationVersion(site, {});
		expect(current).not.toBe(previous);
		previous = current;
	}
	expect(applicationVersion(site, { VITE_ORIGIN: 'https://changed.example.com' })).not.toBe(
		previous
	);
	expect(applicationVersion(site, { PUBLIC_NAME: 'Changed' })).not.toBe(previous);
	expect(applicationVersion(site, { GITHUB_RUN_ID: '123' })).toBe(previous);
	rmSync(path.join(site, 'src/routes/+page.svelte'));
	expect(applicationVersion(site, {})).not.toBe(previous);
});

test('Git-maintained additional static assets are included without synced course files', () => {
	const site = fixture();
	execFileSync('git', ['init', '-q', site]);
	write(site, 'static/.gitignore', '*\n!.gitignore\n!favicon.png\n!custom.svg\n');
	write(site, 'static/custom.svg', '<svg/>');
	const initial = applicationVersion(site, {});
	write(site, 'static/course/note.png', 'synced content');
	expect(applicationVersion(site, {})).toBe(initial);
	write(site, 'static/custom.svg', '<svg><path/></svg>');
	expect(applicationVersion(site, {})).not.toBe(initial);
});

test('isolated snapshots preserve the canonical maintained static inventory version', () => {
	const canonical = fixture();
	const snapshot = fixture();
	execFileSync('git', ['init', '-q', canonical]);
	write(canonical, 'static/.gitignore', '*\n!.gitignore\n!favicon.png\n!custom.svg\n');
	write(canonical, 'static/custom.svg', '<svg/>');
	const version = applicationVersion(canonical, { NODE_ENV: 'production' });
	expect(applicationVersion(snapshot, { NODE_ENV: 'production' })).not.toBe(version);
	expect(applicationVersion(snapshot, { WISCONSIN_APPLICATION_VERSION: version })).toBe(version);
});

test('invalid isolated application versions fail before compilation', () => {
	for (const version of ['', '../version', 'a'.repeat(63), 'A'.repeat(64)])
		expect(() => applicationVersion(fixture(), { WISCONSIN_APPLICATION_VERSION: version })).toThrow(
			'WISCONSIN_APPLICATION_VERSION'
		);
});
