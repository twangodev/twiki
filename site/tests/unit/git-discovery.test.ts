import { expect, test, spyOn } from 'bun:test';
import * as childProcess from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { publicationFixture } from '../publication-fixture';
import { nestedPublicationFixture } from '../nested-publication-fixture';
import { discoverSourceFiles, resolveProject } from '../../tooling/lib/project-config';
import { contentRepositories } from '../../tooling/lib/dev-git-state';

const git = (directory: string, ...args: string[]) =>
	childProcess.execFileSync('git', ['-C', directory, '-c', 'commit.gpgsign=false', ...args], {
		encoding: 'utf8',
		stdio: 'pipe'
	});

test('recursive source discovery avoids covered course walks and retains inactive, unindexed and directly tracked courses', () => {
	const fixture = publicationFixture();
	try {
		nestedPublicationFixture(fixture);
		fixture.write(
			'twiki.config.json',
			JSON.stringify({ version: 1, contentDir: 'content', discovery: 'git' })
		);
		const project = resolveProject(process.cwd(), fixture.repo);
		const calls = spyOn(childProcess, 'execFileSync');
		let original: string[];
		try {
			original = discoverSourceFiles(project);
			expect(original).toContain('sp99-cs101/projects/nested.md');
			expect(
				calls.mock.calls
					.filter(([, args]) => args?.includes('ls-files') && args.includes('--recurse-submodules'))
					.map(([, args]) => args![1])
			).toEqual([project.contentDir]);
		} finally {
			calls.mockRestore();
		}
		git(fixture.repo, 'config', 'submodule.sp99-cs101.active', 'false');
		expect(discoverSourceFiles(project)).toEqual(original);
		git(fixture.repo, 'config', '--unset', 'submodule.sp99-cs101.active');
		git(fixture.repo, 'rm', '--cached', '-f', 'content/sp99-cs101');
		expect(discoverSourceFiles(project)).toEqual(original);
		const blob = git(
			fixture.repo,
			'hash-object',
			'-w',
			path.join(fixture.course, 'notes/public.md')
		).trim();
		git(
			fixture.repo,
			'update-index',
			'--add',
			'--cacheinfo',
			'100644',
			blob,
			'content/sp99-cs101/notes/public.md'
		);
		expect(discoverSourceFiles(project)).toEqual(original);
	} finally {
		rmSync(fixture.repo, { recursive: true, force: true });
	}
});

test('repository metadata supports unborn, detached and linked worktrees and exposes Git failures', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'twiki-git-metadata-'));
	try {
		mkdirSync(path.join(root, 'content'));
		writeFileSync(
			path.join(root, 'twiki.config.json'),
			JSON.stringify({ version: 1, contentDir: 'content', discovery: 'git' })
		);
		writeFileSync(path.join(root, 'content/note.md'), '# Note');
		git(root, 'init');
		git(root, 'add', '.');
		const unborn = contentRepositories(root)[0];
		expect(unborn.head).toBe('unborn');
		expect(unborn.gitDirectory).toBe(path.join(root, '.git'));
		expect(unborn.tracked.toString()).toContain('content/note.md');
		git(
			root,
			'-c',
			'user.name=Fixture',
			'-c',
			'user.email=fixture@example.test',
			'commit',
			'-m',
			'Fixture'
		);
		git(root, 'checkout', '--detach', '--quiet');
		const head = git(root, 'rev-parse', '--verify', 'HEAD').trim();
		expect(contentRepositories(root)[0].head).toBe(head);
		const linked = path.join(root, 'linked');
		git(root, 'worktree', 'add', '--detach', '--quiet', linked);
		const repository = contentRepositories(linked)[0];
		expect(repository.head).toBe(head);
		expect(repository.commonDirectory).toBe(path.join(root, '.git'));
		expect(repository.gitDirectory).not.toBe(repository.commonDirectory);
		expect(repository.index).toBe(path.join(repository.gitDirectory, 'index'));
		const exec = childProcess.execFileSync;
		const failure = Object.assign(new Error('metadata failure'), { status: 128 });
		const spy = spyOn(childProcess, 'execFileSync').mockImplementation((command, args, options) => {
			if (args?.includes('--git-dir')) throw failure;
			return exec(command, args, options);
		});
		try {
			expect(() => contentRepositories(root)).toThrow('metadata failure');
		} finally {
			spy.mockRestore();
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
