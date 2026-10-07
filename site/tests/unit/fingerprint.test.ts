import { expect, test } from 'bun:test';
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stageFingerprint, stages, type Stage } from '../../tooling/fingerprint';

function fixture() {
	const root = mkdtempSync(path.join(tmpdir(), 'wisconsin-fingerprint-'));
	const write = (file: string, text: string) => {
		const target = path.join(root, file);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, text);
	};
	write('package.json', '{}');
	write('tsconfig.json', '{}');
	write('bun.lock', 'locked dependencies');
	for (const { entries, assets } of Object.values(stages)) {
		for (const file of entries) write(file, 'export const value = 1;');
		for (const file of assets) write(file, 'asset');
	}
	write('tooling/compiler.ts', "export { value } from './lib/parser';");
	write('tooling/lib/parser.ts', "export { value } from './nested';");
	write('tooling/lib/nested.ts', 'export const value = 1;');
	write('tooling/lib/file-history.ts', "export { value } from './git-revisions';");
	write('tooling/lib/git-revisions.ts', 'export const value = 1;');
	return { root, write, fingerprint: (stage: Stage) => stageFingerprint(stage, root) };
}

test('transitive imports invalidate parsing; checker edits do not; new imports are discovered', async () => {
	const { root, write, fingerprint } = fixture();
	try {
		const initial = await fingerprint('parser');
		write('tooling/check-links.ts', 'export const value = 2;');
		expect(await fingerprint('parser')).toBe(initial);
		write('tooling/lib/nested.ts', 'export const value = 2;');
		expect(await fingerprint('parser')).not.toBe(initial);
		write('tooling/lib/added.ts', 'export const value = 3;');
		write('tooling/lib/nested.ts', "export { value } from './added';");
		const added = await fingerprint('parser');
		write('tooling/lib/added.ts', 'export const value = 4;');
		expect(await fingerprint('parser')).not.toBe(added);
		rmSync(path.join(root, 'tooling/lib/added.ts'));
		await expect(fingerprint('parser')).rejects.toThrow();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('assets and subprocesses invalidate only their declared stages', async () => {
	const { root, write, fingerprint } = fixture();
	try {
		const parser = await fingerprint('parser');
		const social = await fingerprint('social');
		const rmd = await fingerprint('rmd');
		const files = await fingerprint('files');
		write('assets/social-background.svg', 'new background');
		expect(await fingerprint('social')).not.toBe(social);
		expect(await fingerprint('parser')).toBe(parser);
		expect(await fingerprint('rmd')).toBe(rmd);
		write('tooling/lib/knit-rmd.R', 'new R renderer');
		expect(await fingerprint('rmd')).not.toBe(rmd);
		const updatedFiles = await fingerprint('files');
		expect(updatedFiles).not.toBe(files);
		write('tooling/lib/history-worker.ts', 'export const value = 2;');
		expect(await fingerprint('files')).not.toBe(updatedFiles);
		const history = await fingerprint('history');
		write('tooling/lib/git-revisions.ts', 'export const value = 2;');
		expect(await fingerprint('history')).not.toBe(history);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('lazy dynamic imports retain transitive dependency invalidation', async () => {
	const { root, write, fingerprint } = fixture();
	try {
		write(
			'tooling/pipeline.ts',
			"export async function prepare() { return import('./compiler'); }"
		);
		const initial = await fingerprint('pipeline');
		write('tooling/lib/nested.ts', 'export const value = 2;');
		expect(await fingerprint('pipeline')).not.toBe(initial);
		write('tooling/lib/added.ts', 'export const value = 3;');
		write(
			'tooling/lib/nested.ts',
			"export const value = 2; export async function parse() { return import('./added'); }"
		);
		const added = await fingerprint('pipeline');
		write('tooling/lib/added.ts', 'export const value = 4;');
		expect(await fingerprint('pipeline')).not.toBe(added);
		rmSync(path.join(root, 'tooling/lib/added.ts'));
		await expect(fingerprint('pipeline')).rejects.toThrow();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('fingerprints survive checkout relocation and invalidate dependencies and resolver configuration', async () => {
	const { root, write, fingerprint } = fixture();
	const relocated = mkdtempSync(path.join(tmpdir(), 'wisconsin-relocated-'));
	try {
		const initial = await fingerprint('parser');
		cpSync(root, relocated, { recursive: true });
		expect(await stageFingerprint('parser', relocated)).toBe(initial);
		write('bun.lock', 'upgraded dependencies');
		const upgraded = await fingerprint('parser');
		expect(upgraded).not.toBe(initial);
		write('tsconfig.json', '{"compilerOptions":{"target":"esnext"}}');
		expect(await fingerprint('parser')).not.toBe(upgraded);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(relocated, { recursive: true, force: true });
	}
});

test('tooling fingerprints work before SvelteKit generates its tsconfig', async () => {
	const { root, write, fingerprint } = fixture();
	try {
		write('tsconfig.json', '{"extends":"./build/.svelte-kit/tsconfig.json"}');
		const fresh = await fingerprint('parser');
		write('build/.svelte-kit/tsconfig.json', '{"compilerOptions":{"target":"esnext"}}');
		expect(await fingerprint('parser')).toBe(fresh);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('production parser depends on file policy without depending on R rendering', async () => {
	const { root, write, fingerprint } = fixture();
	const site = path.resolve(import.meta.dirname, '../..');
	try {
		// Scan the maintained import graph, so a future accidental course-files import fails.
		cpSync(path.join(site, 'tooling'), path.join(root, 'tooling'), { recursive: true });
		cpSync(path.join(site, 'src/lib'), path.join(root, 'src/lib'), { recursive: true });
		cpSync(path.join(site, 'package.json'), path.join(root, 'package.json'));
		symlinkSync(path.join(site, 'node_modules'), path.join(root, 'node_modules'), 'dir');
		const parser = await fingerprint('parser');
		const files = await fingerprint('files');
		const source = (file: string) => readFileSync(path.join(root, file), 'utf8');
		write(
			'tooling/lib/rmd-previews.ts',
			source('tooling/lib/rmd-previews.ts') + '\n// renderer change\n'
		);
		expect(await fingerprint('parser')).toBe(parser);
		expect(await fingerprint('files')).not.toBe(files);
		write('tooling/lib/r-runtime.ts', source('tooling/lib/r-runtime.ts') + '\n// runtime change\n');
		expect(await fingerprint('parser')).toBe(parser);
		write(
			'tooling/lib/file-policy.ts',
			source('tooling/lib/file-policy.ts').replace("'vendor',", "'vendor', 'generated',")
		);
		expect(await fingerprint('parser')).not.toBe(parser);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
