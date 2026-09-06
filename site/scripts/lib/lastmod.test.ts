import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGitDateMap, coerceDate, repositoryDates, resolveDates } from './lastmod';

test('Git dates survive renames, checkouts, and submodule caches', () => {
	const root = mkdtempSync(join(tmpdir(), 'wisconsin-dates-'));
	const course = join(root, 'content/course');
	mkdirSync(course, { recursive: true });
	const git = (repo: string, ...args: string[]) =>
		execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
	const commit = (repo: string, day: string) => {
		git(repo, 'add', '.');
		execFileSync('git', ['-C', repo, '-c', 'commit.gpgsign=false', 'commit', '-m', day], {
			stdio: 'pipe',
			env: {
				...process.env,
				GIT_AUTHOR_DATE: `${day}T12:00:00Z`,
				GIT_COMMITTER_DATE: `${day}T12:00:00Z`
			}
		});
	};
	try {
		for (const repo of [root, course]) {
			git(repo, 'init');
			git(repo, 'config', 'user.email', 'test@example.invalid');
			git(repo, 'config', 'user.name', 'Test');
		}
		writeFileSync(join(course, 'old.md'), '# A note\n');
		commit(course, '2024-01-01');
		git(course, 'mv', 'old.md', 'new.md');
		commit(course, '2024-02-01');
		writeFileSync(join(course, 'new.md'), '# A note\n\nUpdated.\n');
		commit(course, '2024-03-01');
		const dates = repositoryDates(course);
		expect(dates.created['new.md']).toBe(Date.parse('2024-01-01T12:00:00Z') / 1000);
		expect(dates.modified['new.md']).toBe(Date.parse('2024-03-01T12:00:00Z') / 1000);
		expect(dates.created['old.md']).toBeUndefined();
		writeFileSync(
			join(root, '.gitmodules'),
			'[submodule "course"]\npath = content/course\nurl = example.invalid\n'
		);
		writeFileSync(join(root, 'content/index.md'), '# Home\n');
		commit(root, '2024-04-01');
		const cache = join(root, 'cache');
		const first = buildGitDateMap(root, cache);
		utimesSync(join(course, 'new.md'), new Date(), new Date());
		expect(buildGitDateMap(root, cache)).toEqual(first);
		expect(first.created['course/new.md']).toBe(dates.created['new.md']);
		expect(first.modified.index).toBeUndefined();
		expect(first.modified['index.md']).toBe(Date.parse('2024-04-01T12:00:00Z') / 1000);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('dates are explicit or historical, never filesystem or build timestamps', () => {
	const gitDates = { created: { 'note.md': 1704110400 }, modified: { 'note.md': 1706788800 } };
	const resolve = (frontmatter: Record<string, unknown>) =>
		resolveDates({ relativePath: 'note.md', frontmatter, gitDates });
	expect(resolve({ date: '2020-01-01' }).published).toBeUndefined();
	expect(resolve({ created: '2020-01-01' }).modified?.toISOString()).toBe(
		'2024-02-01T12:00:00.000Z'
	);
	expect(resolve({ published: '2024-01-15' }).published?.toISOString()).toBe(
		'2024-01-15T00:00:00.000Z'
	);
	expect(resolve({ modified: 'invalid' }).modified?.toISOString()).toBe('2024-02-01T12:00:00.000Z');
	expect(resolveDates({ relativePath: 'untracked', frontmatter: {}, gitDates })).toEqual({
		created: undefined,
		modified: undefined,
		published: undefined
	});
	for (const value of ['invalid', '2024-02-30', '2999-01-01', '2024-01-01T12:00:00', true, null])
		expect(coerceDate('note', value)).toBeUndefined();
	expect(coerceDate('note', '2024-01-01')?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
});
