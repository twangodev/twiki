import { describe, expect, test } from 'bun:test';
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
import { browsablePath, buildCourseFiles, previewText } from './course-files';
import {
	directoryEntries,
	fileRoute,
	fileSize,
	fileTree,
	type CourseFile
} from '../../src/lib/files';

describe('course file discovery', () => {
	test('keeps source paths and excludes private, hidden, dependency and secret paths', () => {
		for (const file of [
			'src/Main.java',
			'lecture notes/example #1.py',
			'p1/Makefile',
			'data/results.csv'
		])
			expect(browsablePath(file)).toBe(true);
		for (const file of [
			'.env',
			'.git/config',
			'src/.env.local',
			'../escape',
			'/absolute',
			'private/note.md',
			'node_modules/a.js',
			'build/Main.class',
			'keys/server.pem',
			'credentials.json',
			'a\\b',
			'bad\nname'
		])
			expect(browsablePath(file)).toBe(false);
	});
	test('preserves complete UTF-8 files and rejects binary data anywhere in a file', () => {
		expect(previewText(Buffer.from('hello\nworld'))).toEqual({
			text: 'hello\nworld'
		});
		expect(previewText(Buffer.from([0, 1, 2]))).toBeUndefined();
		expect(previewText(Buffer.from([255, 254]))).toBeUndefined();
		const large = previewText(Buffer.from('x\n'.repeat(3000)))!;
		expect(large.text.split('\n')).toHaveLength(3001);
		expect(previewText(Buffer.from('é'.repeat(200000)))?.text).toBe('é'.repeat(200000));
		expect(
			previewText(Buffer.concat([Buffer.alloc(300000, 65), Buffer.from([0])]))
		).toBeUndefined();
	});
	test('exports tracked files safely and removes stale generated artifacts', async () => {
		const repo = mkdtempSync(path.join(tmpdir(), 'wisconsin-files-test-'));
		const course = path.join(repo, 'content/test-course');
		const site = path.join(repo, 'site');
		const git = (...args: string[]) =>
			execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
		try {
			mkdirSync(course, { recursive: true });
			mkdirSync(site);
			writeFileSync(
				path.join(repo, '.gitmodules'),
				'[submodule "test"]\npath = content/test-course\n'
			);
			writeFileSync(
				path.join(course, 'Main.java'),
				'class Main { String text = "<script>alert(1)</script>"; }'
			);
			writeFileSync(path.join(course, 'page.html'), '<script>alert(1)</script>');
			writeFileSync(path.join(course, 'README.md'), '# Notes');
			writeFileSync(path.join(course, '.env'), 'secret');
			writeFileSync(path.join(course, 'binary.dat'), Buffer.from([0, 1, 2]));
			symlinkSync(path.join(course, 'README.md'), path.join(course, 'linked.md'));
			git('init');
			git('add', '.');
			writeFileSync(path.join(course, 'untracked.java'), 'excluded');
			await buildCourseFiles(site, new Set(['test-course/README']));
			const output = path.join(site, '.generated/assets');
			const files: CourseFile[] = JSON.parse(
				readFileSync(path.join(output, '_files/index/test-course.json'), 'utf8')
			);
			expect(files.map((file) => file.path)).toEqual([
				'Main.java',
				'README.md',
				'binary.dat',
				'page.html'
			]);
			expect(files.find((file) => file.path === 'README.md')?.note).toBe('/test-course/README');
			const html = files.find((file) => file.path === 'page.html')!;
			expect(html.kind).toBe('text');
			expect(html.download).toEndWith('.bin');
			expect(readFileSync(path.join(output, html.download!), 'utf8')).toBe(
				'<script>alert(1)</script>'
			);
			expect(files.find((file) => file.path === 'binary.dat')?.kind).toBe('binary');
			git('rm', '-f', 'content/test-course/page.html');
			await buildCourseFiles(site, new Set());
			expect(existsSync(path.join(output, html.download!))).toBe(false);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});
});

describe('file navigation', () => {
	test('preserves filenames, sorts directories first and traverses exact paths', () => {
		const files: CourseFile[] = ['z.txt', 'src/Test10.java', 'src/Test2.java', 'README.md'].map(
			(path) => ({ path, size: 10, kind: 'text' })
		);
		const tree = fileTree(files);
		expect(tree.map((node) => node.name)).toEqual(['src', 'README.md', 'z.txt']);
		expect(directoryEntries(tree, 'src')?.map((node) => node.name)).toEqual([
			'Test2.java',
			'Test10.java'
		]);
		expect(directoryEntries(tree, 'missing')).toBeUndefined();
		expect(directoryEntries(tree, 'z.txt')).toBeUndefined();
		expect(fileRoute('test-course', 'notes/a #1?.java')).toBe(
			'/test-course/files/notes/a%20%231%3F.java'
		);
		expect(fileSize(2048)).toBe('2.0 KB');
	});
});
