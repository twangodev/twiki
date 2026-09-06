import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFileHistoryBuilder, parseBlame } from '../../tooling/lib/file-history';
import { browsablePath } from '../../tooling/lib/course-files';
import { blameAt, type FileHistory } from '../../src/lib/file-history';

test('history follows renames, emits scoped diffs and blame, detects local edits, and reuses cached assets', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'wisconsin-history-'));
	const repo = path.join(root, 'repo'),
		output = path.join(root, 'assets'),
		cache = path.join(root, 'cache');
	mkdirSync(repo);
	const git = (...args: string[]) =>
		execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: 'pipe' });
	const commit = (message: string) => {
		git('add', '.');
		git('commit', '-m', message);
		return git('rev-parse', 'HEAD').trim();
	};
	const read = (url: string) =>
		readFileSync(path.join(output, url.replace('/_files/', '')), 'utf8');
	try {
		git('init');
		git('config', 'user.name', 'Test Author');
		git('config', 'user.email', 'private@example.com');
		writeFileSync(path.join(repo, 'Old.java'), 'first\nsecond\n');
		const initial = commit('Initial file');
		git('mv', 'Old.java', 'New.java');
		commit('Rename file');
		writeFileSync(path.join(repo, 'New.java'), 'first\nchanged\n');
		writeFileSync(path.join(repo, '.env'), 'UNRELATED_SECRET=hidden');
		commit('Change second line');
		const build = createFileHistoryBuilder(repo, output, cache, browsablePath)!;
		const file = { path: 'New.java', kind: 'text' as const, size: 14 };
		const bytes = readFileSync(path.join(repo, file.path));
		const url = build(file, bytes)!;
		const history: FileHistory = JSON.parse(read(url));
		expect(history.commits.map((c) => c.subject)).toEqual([
			'Change second line',
			'Rename file',
			'Initial file'
		]);
		expect(history.commits[1].previousPath).toBe('Old.java');
		expect(read(history.commits[0].diff!)).toContain('+changed');
		expect(read(history.commits[0].diff!)).not.toContain('UNRELATED_SECRET');
		const blame = JSON.parse(read(history.blame!));
		expect(blameAt(blame, 1)?.commit.id).toBe(initial);
		expect(blameAt(blame, 2)?.commit.subject).toBe('Change second line');
		expect(JSON.stringify(blame)).not.toContain('private@example.com');
		rmSync(output, { recursive: true });
		const cachedBuild = createFileHistoryBuilder(repo, output, cache, browsablePath)!;
		expect(cachedBuild(file, bytes)).toBe(url);
		expect(existsSync(path.join(output, history.blame!.replace('/_files/', '')))).toBe(true);
		const dirty: FileHistory = JSON.parse(read(cachedBuild(file, Buffer.from('local edit'))!));
		expect(dirty.blame).toBeUndefined();
		expect(dirty.notice).toContain('Working copy');
		const stricter = createFileHistoryBuilder(
			repo,
			output,
			cache,
			(file) => browsablePath(file) && file !== 'Old.java'
		)!;
		const restrictedCached: FileHistory = JSON.parse(read(stricter(file, bytes)!));
		expect(restrictedCached.commits).toHaveLength(2);
		expect(restrictedCached.blame).toBeUndefined();
		expect(restrictedCached.commits[1].diff).toBeUndefined();
		mkdirSync(path.join(repo, '.private'));
		writeFileSync(path.join(repo, '.private/Hidden.java'), 'not for export\n');
		commit('Private file');
		git('mv', '.private/Hidden.java', 'Visible.java');
		commit('Move into view');
		const restrictedBuild = createFileHistoryBuilder(repo, output, cache, browsablePath)!;
		const restricted: FileHistory = JSON.parse(
			read(
				restrictedBuild(
					{ path: 'Visible.java', kind: 'text', size: 15 },
					readFileSync(path.join(repo, 'Visible.java'))
				)!
			)
		);
		expect(restricted.commits).toHaveLength(1);
		expect(restricted.commits[0].diff).toBeUndefined();
		expect(restricted.blame).toBeUndefined();
		expect(JSON.stringify(restricted)).not.toContain('.private/Hidden.java');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('incremental blame sorts ranges and reuses commit metadata', () => {
	const id = 'a'.repeat(40);
	const blame = parseBlame(
		`${id} 3 3 2\nauthor A\nauthor-time 0\nsummary Example\nfilename x\n${id} 1 1 2\nfilename x\n`
	);
	expect(blame.ranges).toEqual([
		[1, 2, id],
		[3, 4, id]
	]);
	expect(blameAt(blame, 4)?.commit.author).toBe('A');
	expect(blameAt(blame, 5)).toBeUndefined();
});
