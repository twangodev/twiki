import { expect, test } from 'bun:test';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
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

test('installed styles scan engine source without Git ignores or generated consumer data', async () => {
	const root = mkdtempSync(path.join(tmpdir(), 'twiki-style-sources-'));
	try {
		cpSync(path.resolve(import.meta.dirname, '../../src'), path.join(root, 'src'), {
			recursive: true
		});
		symlinkSync(
			path.resolve(import.meta.dirname, '../../node_modules'),
			path.join(root, 'node_modules'),
			'dir'
		);
		for (const file of [
			'build/generated/cache/page.json',
			'static/note.md',
			'src/lib/generated/nav.json'
		]) {
			mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
			writeFileSync(path.join(root, file), 'w-[12345px]');
		}
		const entry = path.join(root, 'src/routes/layout.css');
		const compiler = await compile(readFileSync(entry, 'utf8'), {
			base: path.dirname(entry),
			onDependency() {}
		});
		expect(compiler.root).toBe('none');
		const scanner = new Scanner({ sources: compiler.sources });
		const candidates = scanner.scan();
		expect(candidates).toContain('min-h-screen');
		expect(candidates).not.toContain('w-[12345px]');
		expect(scanner.files.every((file) => file.startsWith(path.join(root, 'src') + path.sep))).toBe(
			true
		);
		expect(scanner.files.some((file) => file.includes('/src/lib/generated/'))).toBe(false);
		expect(compiler.build(candidates)).toContain('.min-h-screen');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
