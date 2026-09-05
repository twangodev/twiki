import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildFileIcons, resolveIcon } from './file-icons';
import { selectFileIcon, type FileIconTheme } from '../../src/lib/file-icons';

test('resolves language icons, exact filenames, compound extensions, and fallbacks', () => {
	for (const [name, icon] of Object.entries({
		'Main.JAVA': 'java',
		'main.py': 'python',
		'notes.pdf': 'pdf',
		'build.gradle': 'gradle',
		'README.md': 'readme',
		'package.json': 'nodejs',
		'index.d.ts': 'typescript-def'
	})) {
		expect(resolveIcon(name)).toBe(icon);
	}
	expect(resolveIcon('unknown.xyz')).toBe('file');
	expect(resolveIcon('constructor')).toBe('file');
	expect(resolveIcon('src', true)).toBe('folder-src');
	expect(resolveIcon('src', true, true)).toBe('folder-src-open');
	expect(resolveIcon('config.toml', false, false, true)).toBe('toml_light');
	expect(resolveIcon('config.toml')).toBe('toml');
});

test('exports only used icons, theme variants, folder states, and their license', () => {
	const site = mkdtempSync(path.join(tmpdir(), 'wisconsin-icon-test-'));
	try {
		buildFileIcons(site, ['src/Main.java', 'src/index.d.ts', 'README.md', 'config.toml']);
		const theme: FileIconTheme = JSON.parse(
			readFileSync(path.join(site, 'src/lib/generated/file-icons.json'), 'utf8')
		);
		const output = path.join(site, '.generated/assets/_files/icons');
		expect(selectFileIcon(theme, 'Main.JAVA').dark).toBe('java');
		expect(selectFileIcon(theme, 'src', true, true).dark).toBe('folder-src-open');
		expect(selectFileIcon(theme, 'constructor')).toEqual(theme.file);
		expect(selectFileIcon(theme, 'unknown', true)).toEqual({
			light: theme.folder.light,
			dark: theme.folder.dark,
			expanded: theme.folder.expanded
		});
		for (const variants of [
			theme.file,
			theme.folder,
			theme.folder.expanded,
			...Object.values(theme.files),
			...Object.values(theme.folders).flatMap((folder) => [folder, folder.expanded])
		]) {
			for (const icon of [variants.light, variants.dark])
				expect(existsSync(path.join(output, `${icon}.svg`))).toBe(true);
		}
		expect(readdirSync(output).length).toBeLessThan(20);
		expect(readFileSync(path.join(output, 'LICENSE.txt'), 'utf8')).toContain('MIT');
	} finally {
		rmSync(site, { recursive: true, force: true });
	}
});
