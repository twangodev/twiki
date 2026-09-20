import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildHistories } from '../../tooling/lib/history-pool';
import { createFileHistoryBuilder } from '../../tooling/lib/file-history';
import { browsablePath, fileHistoryPolicyKey } from '../../tooling/lib/course-files';
import type { CourseFile } from '../../src/lib/files';

const git = (repo: string, ...args: string[]) =>
	execFileSync('git', ['-C', repo, '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' });
function init(repo: string) {
	mkdirSync(repo, { recursive: true });
	git(repo, 'init');
	git(repo, 'config', 'user.name', 'Test');
	git(repo, 'config', 'user.email', 'test@example.com');
}

test('course cache survives processes and invalidates edits, missing outputs, HEAD, notes and policy', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'wisconsin-build-cache-'));
	let site = path.join(root, 'site');
	const course = path.join(root, 'content/test-course');
	const module = path.resolve(import.meta.dirname, '../../tooling/lib/course-files.ts');
	try {
		init(root);
		init(course);
		mkdirSync(site);
		writeFileSync(
			path.join(root, '.gitmodules'),
			'[submodule "test-course"]\npath = content/test-course\n'
		);
		writeFileSync(path.join(course, 'README.md'), '# Public\n');
		writeFileSync(path.join(course, 'private.txt'), 'private original\n');
		writeFileSync(path.join(course, 'publish.yaml'), 'include:\n  - README.md\n');
		git(course, 'add', '.');
		git(course, 'commit', '-m', 'Initial');
		git(root, 'add', '.');
		git(root, 'config', 'submodule.test-course.url', course);
		const run = (edition = 'false', notes = ['test-course/README']) =>
			execFileSync(
				'bun',
				[
					'-e',
					`import { buildCourseFiles } from ${JSON.stringify(module)}; await buildCourseFiles(${JSON.stringify(site)}, new Set(${JSON.stringify(notes)}));`
				],
				{
					env: { ...process.env, WISCONSIN_CONTENT_REPO: root, VITE_PUBLIC_EDITION: edition },
					encoding: 'utf8'
				}
			);
		const full = path.join(site, 'build/generated/assets/_files');
		const index = () =>
			JSON.parse(readFileSync(path.join(full, 'index/test-course.json'), 'utf8')) as CourseFile[];
		expect(run()).toContain('1 changed courses');
		expect(index()).toHaveLength(2);
		expect(run()).toContain('(1 reused)');
		const original = index().find((file) => file.path === 'private.txt')!;
		writeFileSync(path.join(course, 'private.txt'), 'private modified\n');
		expect(run()).toContain('1 changed courses');
		const edited = index().find((file) => file.path === 'private.txt')!;
		expect(edited.download).not.toBe(original.download);
		const blob = path.join(full, edited.download!.replace('/_files/', ''));
		rmSync(blob);
		expect(run()).toContain('1 changed courses');
		expect(readFileSync(blob, 'utf8')).toBe('private modified\n');
		git(course, 'add', '.');
		git(course, 'commit', '-m', 'Edit');
		expect(run()).toContain('1 changed courses');
		expect(run('false', [])).toContain('1 changed courses');
		expect(index().find((file) => file.path === 'README.md')?.note).toBeUndefined();
		expect(run('true')).toContain('1 changed courses');
		const publicRoot = path.join(site, 'build/generated/public-files');
		const publicIndex = () =>
			JSON.parse(
				readFileSync(path.join(publicRoot, 'index/test-course.json'), 'utf8')
			) as CourseFile[];
		expect(publicIndex().find((file) => file.path === 'private.txt')?.locked).toBe(true);
		expect(publicIndex().every((file) => !file.history)).toBe(true);
		expect(existsSync(path.join(publicRoot, 'history'))).toBe(false);
		expect(existsSync(blob)).toBe(true);
		expect(run('true')).toContain('(1 reused)');
		writeFileSync(path.join(course, 'publish.yaml'), 'include: []\n');
		expect(run('true')).toContain('1 changed courses');
		expect(publicIndex().every((file) => file.locked && !file.download)).toBe(true);
		git(course, 'rm', 'private.txt');
		expect(run()).toContain('1 changed courses');
		expect(index().some((file) => file.path === 'private.txt')).toBe(false);
		const oldSite = site;
		site = path.join(root, 'relocated-site');
		mkdirSync(site);
		cpSync(path.join(oldSite, 'build/generated/cache'), path.join(site, 'build/generated/cache'), {
			recursive: true
		});
		expect(run()).toContain('1 changed courses');
		const relocated = path.join(site, 'build/generated/assets/_files');
		const relocatedFiles: CourseFile[] = JSON.parse(
			readFileSync(path.join(relocated, 'index/test-course.json'), 'utf8')
		);
		expect(relocatedFiles.length).toBeGreaterThan(0);
		for (const file of relocatedFiles)
			if (file.download)
				expect(existsSync(path.join(relocated, file.download.replace('/_files/', '')))).toBe(true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}, 30_000);

test('history workers preserve serial output and propagate Git failures', async () => {
	const root = mkdtempSync(path.join(tmpdir(), 'wisconsin-history-workers-'));
	try {
		const jobs = ['a', 'b'].map((name) => {
			const repo = path.join(root, name);
			init(repo);
			writeFileSync(path.join(repo, 'note.txt'), 'first\n');
			git(repo, 'add', '.');
			git(repo, 'commit', '-m', 'Initial');
			writeFileSync(path.join(repo, 'note.txt'), 'changed\n');
			git(repo, 'add', '.');
			git(repo, 'commit', '-m', 'Change');
			const file: CourseFile = { path: 'note.txt', size: 8, kind: 'text' };
			return {
				repo,
				output: path.join(root, 'parallel', name),
				cache: path.join(root, 'cache', name),
				files: [{ file, source: path.join(repo, file.path) }]
			};
		});
		const retained: string[] = [];
		await buildHistories(jobs, (_, output) => retained.push(output));
		expect(retained.length).toBeGreaterThan(2);
		for (const job of jobs) {
			const serial = path.join(root, 'serial', path.basename(job.repo));
			const build = createFileHistoryBuilder(
				job.repo,
				serial,
				path.join(serial, 'cache'),
				browsablePath,
				fileHistoryPolicyKey()
			)!;
			const url = build(job.files[0].file, readFileSync(job.files[0].source))!;
			expect(job.files[0].file.history).toBe(url);
			for (const output of retained.filter((file) => file.startsWith(job.output + path.sep)))
				expect(readFileSync(output)).toEqual(
					readFileSync(path.join(serial, path.relative(job.output, output)))
				);
		}
		writeFileSync(
			path.join(jobs[0].repo, '.git/shallow'),
			execFileSync('git', ['-C', jobs[0].repo, 'rev-parse', 'HEAD'])
		);
		await expect(buildHistories([jobs[0]], () => {})).rejects.toThrow('Full Git history required');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}, 30_000);
