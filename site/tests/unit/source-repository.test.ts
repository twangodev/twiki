import { expect, test, spyOn } from 'bun:test';
import * as childProcess from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { publicationFixture } from '../publication-fixture';
import { captureContentInputs } from '../../tooling/lib/dev-state';
import { resolveProject, sourceRepository } from '../../tooling/lib/project-config';
import { buildGitDateMap } from '../../tooling/lib/lastmod';
import { coursePolicies } from '../../tooling/lib/publishing';

test('repository observations stay inside their source snapshot and fresh scopes detect later HEAD changes', () => {
	const fixture = publicationFixture();
	fixture.write(
		'twiki.config.json',
		JSON.stringify({ version: 1, contentDir: 'content', discovery: 'git', publication: 'policies' })
	);
	try {
		const project = resolveProject(process.cwd(), fixture.repo);
		const cache = path.join(fixture.repo, 'date-cache');
		const dates = buildGitDateMap(fixture.repo, cache, project);
		const snapshot = captureContentInputs(fixture.repo, 'engine');
		const note = path.join(fixture.course, 'notes/public.md');
		fixture.write('content/sp99-cs101/notes/public.md', fixture.publicNote + '\nKnown edit');
		const refreshed = snapshot.refresh(project, 'engine', new Set([note]))!;
		expect(sourceRepository(project, fixture.course)).toBeUndefined();
		let head: string | undefined;
		const calls = spyOn(childProcess, 'execFileSync');
		try {
			refreshed.withDiscovery(() => {
				head = sourceRepository(project, fixture.course)?.head;
				expect(head).toMatch(/^[a-f0-9]{40,64}$/);
				expect(
					sourceRepository(
						{ ...project, contentDir: path.join(fixture.repo, 'other') },
						fixture.course
					)
				).toBeUndefined();
				expect(buildGitDateMap(fixture.repo, cache, project)).toEqual(dates);
				expect(coursePolicies(fixture.repo, project).has('sp99-cs101')).toBe(true);
			});
			expect(calls.mock.calls.filter(([, args]) => args?.includes('HEAD'))).toHaveLength(0);
			expect(calls.mock.calls.filter(([, args]) => args?.includes('--error-unmatch'))).toHaveLength(
				0
			);
		} finally {
			calls.mockRestore();
		}
		expect(sourceRepository(project, fixture.course)).toBeUndefined();
		childProcess.execFileSync(
			'git',
			[
				'-C',
				fixture.course,
				'-c',
				'user.name=Fixture',
				'-c',
				'user.email=fixture@example.test',
				'-c',
				'commit.gpgsign=false',
				'commit',
				'--allow-empty',
				'-m',
				'New HEAD'
			],
			{ stdio: 'pipe' }
		);
		expect(snapshot.withDiscovery(() => sourceRepository(project, fixture.course)?.head)).toBe(
			head
		);
		const current = captureContentInputs(fixture.repo, 'engine');
		expect(current.fingerprint).not.toBe(snapshot.fingerprint);
		expect(current.withDiscovery(() => sourceRepository(project, fixture.course)?.head)).not.toBe(
			head
		);
	} finally {
		rmSync(fixture.repo, { recursive: true, force: true });
	}
});

test('a parent-tracked policy cannot validate an untracked course policy', () => {
	const fixture = publicationFixture();
	fixture.write(
		'twiki.config.json',
		JSON.stringify({ version: 1, contentDir: 'content', discovery: 'git', publication: 'policies' })
	);
	const git = (repo: string, ...args: string[]) =>
		childProcess.execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: 'pipe' });
	try {
		git(fixture.course, 'rm', '--cached', '-f', 'publish.yaml');
		git(fixture.repo, 'rm', '--cached', '-f', 'content/sp99-cs101');
		const blob = git(
			fixture.repo,
			'hash-object',
			'-w',
			path.join(fixture.course, 'publish.yaml')
		).trim();
		git(
			fixture.repo,
			'update-index',
			'--add',
			'--cacheinfo',
			'100644',
			blob,
			'content/sp99-cs101/publish.yaml'
		);
		const project = resolveProject(process.cwd(), fixture.repo);
		const snapshot = captureContentInputs(fixture.repo, 'engine');
		expect(() => snapshot.withDiscovery(() => coursePolicies(fixture.repo, project))).toThrow(
			'invalid or untracked'
		);
	} finally {
		rmSync(fixture.repo, { recursive: true, force: true });
	}
});
