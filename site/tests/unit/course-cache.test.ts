import { describe, expect, spyOn, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	courseFingerprint,
	parseCourseCache,
	readCourseCache,
	saveCourseCache,
	type CourseCacheRecord
} from '../../tooling/lib/course-cache';
import { buildCourseFiles } from '../../tooling/lib/course-files';
import type { CourseFile } from '../../src/lib/files';

const sha = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
function fixture() {
	const root = mkdtempSync(path.join(tmpdir(), 'wisconsin-course-cache-'));
	const repo = path.join(root, 'checkout');
	const course = 'test-course';
	const courseRoot = path.join(repo, 'content', course);
	const site = path.join(repo, 'site');
	const output = path.join(site, 'build/generated/assets/_files');
	const cache = path.join(site, 'build/generated/cache');
	mkdirSync(courseRoot, { recursive: true });
	mkdirSync(output, { recursive: true });
	writeFileSync(path.join(repo, '.gitmodules'), '[submodule "test"]\npath = content/test-course\n');
	writeFileSync(path.join(courseRoot, 'code.txt'), 'hello source');
	const git = (...args: string[]) =>
		execFileSync('git', ['-c', 'commit.gpgsign=false', '-C', repo, ...args], { stdio: 'pipe' });
	git('init');
	git('add', '.');
	git(
		'-c',
		'user.name=Fixture',
		'-c',
		'user.email=fixture@example.invalid',
		'commit',
		'-m',
		'fixture'
	);
	const tracked = ['content/test-course/code.txt'];
	const fp = () =>
		courseFingerprint(repo, course, tracked, 'files-version-full', '["test-course/note"]');
	const context = { repo, course, output, cache };
	const file = path.join(cache, 'course-files/full/test-course.json');
	return { root, repo, courseRoot, site, output, cache, context, file, tracked, fp, git };
}
function save(f: ReturnType<typeof fixture>, history = false) {
	const bytes = 'hello source';
	const blob = `blobs/${sha(bytes)}.bin`;
	const files: CourseFile[] = [
		{ path: 'code.txt', size: bytes.length, kind: 'text', download: `/_files/${blob}` }
	];
	const outputs = new Set([
		path.join(f.output, blob),
		path.join(f.output, 'index/test-course.json')
	]);
	mkdirSync(path.join(f.output, 'blobs'), { recursive: true });
	mkdirSync(path.join(f.output, 'index'), { recursive: true });
	writeFileSync(path.join(f.output, blob), bytes);
	if (history) {
		const name = `${'a'.repeat(64)}.json`;
		files[0].history = `/_files/history/${name}`;
		mkdirSync(path.join(f.output, 'history'), { recursive: true });
		mkdirSync(path.join(f.cache, 'file-history/test-course'), { recursive: true });
		writeFileSync(path.join(f.output, 'history', name), '{"commits":[]}');
		writeFileSync(path.join(f.cache, 'file-history/test-course', name), '{"commits":[]}');
		outputs.add(path.join(f.output, 'history', name));
	}
	writeFileSync(path.join(f.output, 'index/test-course.json'), JSON.stringify(files));
	saveCourseCache(f.file, f.fp(), files, outputs, f.context);
	return { files, blob };
}
function resign(record: CourseCacheRecord) {
	record.payloadSha256 = sha(
		JSON.stringify([
			record.version,
			record.course,
			record.fingerprint,
			record.files,
			record.outputs
		])
	);
	return record;
}

describe('portable course-file cache', () => {
	test('fingerprints ignore checkout path and filesystem timestamps but include exact logical inputs', () => {
		const f = fixture();
		try {
			const initial = f.fp();
			const relocated = path.join(f.root, 'relocated');
			cpSync(f.repo, relocated, { recursive: true });
			expect(
				courseFingerprint(
					relocated,
					'test-course',
					f.tracked,
					'files-version-full',
					'["test-course/note"]'
				)
			).toBe(initial);
			utimesSync(path.join(f.courseRoot, 'code.txt'), 1, 2);
			expect(f.fp()).toBe(initial);
			writeFileSync(path.join(f.courseRoot, 'code.txt'), 'HELLO source');
			expect(f.fp()).not.toBe(initial);
			writeFileSync(path.join(f.courseRoot, 'code.txt'), 'hello source');
			expect(f.fp()).toBe(initial);
			writeFileSync(path.join(f.courseRoot, 'publish.yaml'), 'include: ["**"]\n');
			expect(f.fp()).not.toBe(initial);
			rmSync(path.join(f.courseRoot, 'publish.yaml'));
			expect(f.fp()).toBe(initial);
			expect(
				courseFingerprint(
					f.repo,
					'test-course',
					f.tracked,
					'files-version-public',
					'["test-course/note"]'
				)
			).not.toBe(initial);
			expect(
				courseFingerprint(f.repo, 'test-course', f.tracked, 'files-version-full', '[]')
			).not.toBe(initial);
			rmSync(path.join(f.courseRoot, 'code.txt'));
			expect(f.fp()).not.toBe(initial);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
	test('Git HEAD and tracked additions invalidate even when existing source bytes match', () => {
		const f = fixture();
		try {
			const initial = f.fp();
			f.git(
				'-c',
				'user.name=Fixture',
				'-c',
				'user.email=fixture@example.invalid',
				'commit',
				'--allow-empty',
				'-m',
				'new head'
			);
			expect(f.fp()).not.toBe(initial);
			const after = f.fp();
			writeFileSync(path.join(f.courseRoot, 'added.txt'), 'new');
			expect(
				courseFingerprint(
					f.repo,
					'test-course',
					[...f.tracked, 'content/test-course/added.txt'],
					'files-version-full',
					'["test-course/note"]'
				)
			).not.toBe(after);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
	test('browsable punctuation filenames contribute source bytes to the fingerprint', () => {
		const f = fixture();
		try {
			const name = 'example: part #1?.txt';
			writeFileSync(path.join(f.courseRoot, name), 'first');
			const tracked = [...f.tracked, `content/test-course/${name}`];
			const initial = courseFingerprint(f.repo, 'test-course', tracked, 'version', '[]');
			writeFileSync(path.join(f.courseRoot, name), 'other');
			expect(courseFingerprint(f.repo, 'test-course', tracked, 'version', '[]')).not.toBe(initial);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
	test('relocated metadata and history restore outputs from source without transporting raw blobs', () => {
		const f = fixture();
		try {
			const expected = save(f, true);
			const relocated = path.join(f.root, 'new-checkout');
			cpSync(f.repo, relocated, { recursive: true });
			const context = {
				...f.context,
				repo: relocated,
				output: path.join(relocated, 'site/build/generated/assets/_files'),
				cache: path.join(relocated, 'site/build/generated/cache')
			};
			rmSync(context.output, { recursive: true });
			mkdirSync(context.output, { recursive: true });
			const restored = readCourseCache(
				path.join(context.cache, 'course-files/full/test-course.json'),
				f.fp(),
				context
			);
			expect(restored?.files).toEqual(expected.files);
			expect(restored?.outputs.size).toBe(3);
			expect(readFileSync(path.join(context.output, expected.blob), 'utf8')).toBe('hello source');
			expect(JSON.stringify(JSON.parse(readFileSync(f.file, 'utf8')))).not.toContain(f.repo);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
	test('SHA checks repair corrupted existing outputs and reject corrupt history closure before writes', () => {
		const f = fixture();
		try {
			const expected = save(f, true);
			writeFileSync(path.join(f.output, expected.blob), 'HELLO source');
			expect(readCourseCache(f.file, f.fp(), f.context)).toBeDefined();
			expect(readFileSync(path.join(f.output, expected.blob), 'utf8')).toBe('hello source');
			rmSync(f.output, { recursive: true });
			mkdirSync(f.output, { recursive: true });
			const name = `${'a'.repeat(64)}.json`;
			writeFileSync(path.join(f.cache, 'file-history/test-course', name), 'corrupt');
			expect(readCourseCache(f.file, f.fp(), f.context)).toBeUndefined();
			expect(existsSync(path.join(f.output, expected.blob))).toBe(false);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
	test('missing source, metadata corruption, incomplete inventories and unsafe output paths miss conservatively', () => {
		const f = fixture();
		try {
			save(f, true);
			const original: CourseCacheRecord = JSON.parse(readFileSync(f.file, 'utf8'));
			const corrupt = structuredClone(original);
			corrupt.files[0].kind = 'binary';
			expect(parseCourseCache(corrupt, 'test-course')).toBeUndefined();
			const incomplete = structuredClone(original);
			incomplete.outputs.pop();
			expect(parseCourseCache(incomplete, 'test-course')).toBeUndefined();
			const unsafe = structuredClone(original);
			unsafe.outputs[0].path = '../escape';
			expect(parseCourseCache(resign(unsafe), 'test-course')).toBeUndefined();
			expect(parseCourseCache(original, 'other-course')).toBeUndefined();
			expect(readCourseCache(f.file, 'b'.repeat(64), f.context)).toBeUndefined();
			rmSync(f.output, { recursive: true });
			mkdirSync(f.output, { recursive: true });
			rmSync(path.join(f.courseRoot, 'code.txt'));
			expect(readCourseCache(f.file, original.fingerprint, f.context)).toBeUndefined();
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
	test('symlinked output parents and source paths cannot escape the selected roots', () => {
		const f = fixture();
		try {
			save(f);
			rmSync(f.output, { recursive: true });
			mkdirSync(f.output, { recursive: true });
			const outside = path.join(f.root, 'outside');
			mkdirSync(outside);
			symlinkSync(outside, path.join(f.output, 'blobs'));
			expect(readCourseCache(f.file, f.fp(), f.context)).toBeUndefined();
			expect(existsSync(path.join(outside, `${sha('hello source')}.bin`))).toBe(false);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
	test('buildCourseFiles reuses a cache-only relocated checkout and emits portable current selection', async () => {
		const f = fixture();
		try {
			await buildCourseFiles(f.site, new Set());
			const original = JSON.parse(
				readFileSync(path.join(f.output, 'index/test-course.json'), 'utf8')
			);
			const relocated = path.join(f.root, 'runner');
			cpSync(f.repo, relocated, { recursive: true });
			const site = path.join(relocated, 'site');
			rmSync(path.join(site, 'build/generated/assets'), { recursive: true });
			const log = spyOn(console, 'log').mockImplementation(() => {});
			try {
				await buildCourseFiles(site, new Set());
				expect(
					log.mock.calls.some(([message]) =>
						String(message).includes('0 changed courses (1 reused)')
					)
				).toBe(true);
			} finally {
				log.mockRestore();
			}
			const current = JSON.parse(
				readFileSync(
					path.join(site, 'build/generated/cache/course-files-current-full.json'),
					'utf8'
				)
			);
			expect(current).toEqual(['course-files/full/test-course.json']);
			expect(
				JSON.parse(
					readFileSync(
						path.join(site, 'build/generated/assets/_files/index/test-course.json'),
						'utf8'
					)
				)
			).toEqual(original);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
	test('public reuse invalidates when publication rules change and removes newly locked downloads', async () => {
		const f = fixture();
		const previousEdition = process.env.VITE_PUBLIC_EDITION;
		try {
			process.env.VITE_PUBLIC_EDITION = 'true';
			writeFileSync(path.join(f.courseRoot, 'publish.yaml'), 'include: ["code.txt"]\n');
			f.git('add', 'content/test-course/publish.yaml');
			await buildCourseFiles(f.site, new Set());
			const output = path.join(f.site, 'build/generated/public-files');
			const index = path.join(output, 'index/test-course.json');
			const initial: CourseFile[] = JSON.parse(readFileSync(index, 'utf8'));
			expect(initial[0].locked).toBe(false);
			expect(initial[0].download).toBeDefined();
			await buildCourseFiles(f.site, new Set());
			writeFileSync(path.join(f.courseRoot, 'publish.yaml'), 'include: []\n');
			await buildCourseFiles(f.site, new Set());
			const locked: CourseFile[] = JSON.parse(readFileSync(index, 'utf8'));
			expect(locked[0].locked).toBe(true);
			expect(locked[0].download).toBeUndefined();
			expect(existsSync(path.join(output, initial[0].download!.slice('/_files/'.length)))).toBe(
				false
			);
		} finally {
			if (previousEdition === undefined) delete process.env.VITE_PUBLIC_EDITION;
			else process.env.VITE_PUBLIC_EDITION = previousEdition;
			rmSync(f.root, { recursive: true, force: true });
		}
	});
});
