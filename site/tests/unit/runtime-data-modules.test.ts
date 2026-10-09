import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rolldown } from 'rolldown';
import {
	runtimeDataAssets,
	runtimeDataModuleSource,
	resolveRuntimeDataImport
} from '../../tooling/lib/runtime-data-modules';
import type { NavNode } from '../../src/lib/types';

test('runtime modules preserve JSON catalog keys and escaped titles', async () => {
	const files = Object.create(null);
	files.__proto__ = { light: 'document', dark: 'document' };
	files['ordinary.txt'] = { light: 'text', dark: 'text' };
	const folders = JSON.parse('{"__proto__":{"light":"folder","dark":"folder"}}');
	const data = {
		files,
		folders,
		title: 'Quotes " and \\ slashes\nNew line\u2028Separator\u2029End </script>'
	};
	const source = runtimeDataModuleSource(data);
	const { default: result } = await import(
		`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
	);
	expect(result).toEqual(JSON.parse(JSON.stringify(data)));
	expect(Object.hasOwn(result.files, '__proto__')).toBe(true);
	expect(Object.hasOwn(result.folders, '__proto__')).toBe(true);
	expect(Object.getPrototypeOf(result.files)).toBe(Object.prototype);
	expect(result.files.__proto__).toEqual(files.__proto__);
	expect(result.title).toBe(data.title);
});

for (const input of ['nav.json', 'file-icons.json'] as const) {
	test(`${input} edits update runtime data and SSR but preserve client bundle hashes`, async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'wisconsin-runtime-data-'));
		const json = path.join(root, 'src/lib/generated', input);
		const entry = path.join(root, 'entry.js');
		mkdirSync(path.dirname(json), { recursive: true });
		writeFileSync(
			entry,
			`import navigation from ${JSON.stringify(json)}; export default navigation;`
		);
		const bundle = async (command: 'build' | 'serve', consumer: 'client' | 'server') => {
			const build = await rolldown({
				input: entry,
				plugins: [
					{
						name: 'navigation-test',
						resolveId(source) {
							return resolveRuntimeDataImport(source, { root, command, consumer });
						}
					}
				]
			});
			try {
				const { output } = await build.generate({
					format: 'esm',
					entryFileNames: '[name]-[hash].js'
				});
				return output.map((chunk) => ({
					fileName: chunk.fileName,
					code: chunk.type === 'chunk' ? chunk.code : chunk.source
				}));
			} finally {
				await build.close();
			}
		};
		try {
			const navigation: NavNode[] = [
				{ title: 'Original note', route: '/note', segment: 'note', children: [] }
			];
			const icon = { light: 'document', dark: 'document' };
			const icons = {
				file: icon,
				folder: {
					light: 'folder',
					dark: 'folder',
					expanded: { light: 'folder-open', dark: 'folder-open' }
				},
				files: { 'original.txt': icon },
				folders: {}
			};
			const initial = input === 'nav.json' ? navigation : icons;
			writeFileSync(json, JSON.stringify(initial));
			const client = await bundle('build', 'client');
			const server = await bundle('build', 'server');
			const development = await bundle('serve', 'client');
			const asset = runtimeDataModuleSource(initial);
			const parsed = await import(
				`data:text/javascript;base64,${Buffer.from(asset).toString('base64')}`
			);
			expect(parsed.default).toEqual(initial);
			expect(client[0].code).toContain(JSON.stringify(`/${runtimeDataAssets[input]}`));
			expect(client[0].code).not.toContain('Original note');
			expect(client[0].code).not.toContain('original.txt');
			const updated =
				input === 'nav.json'
					? [{ ...navigation[0], title: 'New note title' }]
					: { ...icons, files: { ...icons.files, 'new.txt': icon } };
			writeFileSync(json, JSON.stringify(updated));
			expect(await bundle('build', 'client')).toEqual(client);
			expect(await bundle('build', 'server')).not.toEqual(server);
			expect(await bundle('serve', 'client')).not.toEqual(development);
			expect(runtimeDataModuleSource(updated)).not.toBe(asset);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
}
