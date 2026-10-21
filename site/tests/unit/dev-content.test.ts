import { expect, test, spyOn } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as childProcess from 'node:child_process';
import { publicationFixture } from '../publication-fixture';
import { nestedPublicationFixture } from '../nested-publication-fixture';
import { contentRepositories } from '../../tooling/lib/dev-git-state';
import { developmentContent } from '../../tooling/lib/dev-content';

test('development worker stays warm, propagates failure, restarts after exit, and closes pending work', async () => {
	const site = mkdtempSync(path.join(tmpdir(), 'twiki-dev-worker-'));
	mkdirSync(path.join(site, 'tooling'));
	writeFileSync(
		path.join(site, 'tooling/dev-content-worker.ts'),
		`
let count = 0;
process.on('message', ({ id, kind, repo, inputs }) => {
  if (kind === 'repositories') {
    if (repo.endsWith('error')) return process.send({ id, error: 'discovery failed' });
    if (repo.endsWith('wait')) return;
    if (repo.endsWith('malformed')) return process.send({ id, repositories: [{}] });
    const directory = repo;
    const result = { directory, gitDirectory: repo + '/.git', commonDirectory: repo + '/.git', index: repo + '/.git/index', config: repo + '/.git/config', worktreeConfig: repo + '/.git/config.worktree' };
    return setTimeout(() => process.send({ id, repositories: [result] }), repo.endsWith('slow') ? 30 : 0);
  }
  if (inputs?.includes('exit')) process.exit(17);
  if (inputs?.includes('wait')) return;
  if (inputs?.includes('error')) return process.send({ id, error: 'rebuild failed' });
  process.send({ id, files: [String(++count), ...(inputs ?? [])] });
});
process.on('disconnect', () => process.exit(0));
`
	);
	const worker = developmentContent(site);
	try {
		expect((await worker.repositories(site))[0].directory).toBe(site);
		expect(await worker.prepare(true)).toEqual(new Set(['1']));
		const discovery = worker.repositories(path.join(site, 'slow'));
		expect(await worker.prepare(false, new Set(['note.md']))).toEqual(new Set(['2', 'note.md']));
		expect((await discovery)[0].directory).toBe(path.join(site, 'slow'));
		await expect(worker.repositories(path.join(site, 'error'))).rejects.toThrow('discovery failed');
		await expect(worker.repositories(path.join(site, 'malformed'))).rejects.toThrow(
			'Invalid repository discovery response'
		);
		await expect(worker.prepare(false, new Set(['error']))).rejects.toThrow('rebuild failed');
		expect(await worker.prepare(false)).toEqual(new Set(['3']));
		await expect(worker.prepare(false, new Set(['exit']))).rejects.toThrow(
			'Content worker exited (17)'
		);
		expect(await worker.prepare(true)).toEqual(new Set(['1']));
		const metadata = worker.repositories(path.join(site, 'wait'));
		void metadata.catch(() => {});
		const pending = worker.prepare(false, new Set(['wait']));
		void pending.catch(() => {});
		worker.close();
		await expect(metadata).rejects.toThrow('Content worker is closed');
		await expect(worker.repositories(site)).rejects.toThrow('Content worker is closed');
		await expect(pending).rejects.toThrow('Content worker is closed');
		await expect(worker.prepare(true)).rejects.toThrow('Content worker is closed');
	} finally {
		worker.close();
		rmSync(site, { recursive: true, force: true });
	}
});

test('the real worker discovers fresh nested Git watchers without parent Git processes or generated state', async () => {
	const fixture = publicationFixture();
	const { git } = nestedPublicationFixture(fixture);
	const site = path.join(fixture.repo, 'site');
	mkdirSync(site);
	symlinkSync(
		path.resolve(import.meta.dirname, '../../tooling'),
		path.join(site, 'tooling'),
		'dir'
	);
	const expected = contentRepositories(fixture.repo).map(
		({ directory, gitDirectory, commonDirectory, index, config, worktreeConfig }) => ({
			directory,
			gitDirectory,
			commonDirectory,
			index,
			config,
			worktreeConfig
		})
	);
	const worker = developmentContent(site);
	const exec = spyOn(childProcess, 'execFileSync');
	try {
		expect(await worker.repositories(fixture.repo)).toEqual(expected);
		expect(exec.mock.calls).toHaveLength(0);
		expect(existsSync(path.join(site, 'build'))).toBe(false);
		exec.mockRestore();
		git(fixture.course, 'rm', '--cached', '-f', 'projects');
		expect((await worker.repositories(fixture.repo)).map((repo) => repo.directory)).toEqual([
			fixture.repo,
			fixture.course
		]);
		fixture.write('twiki.config.json', 'invalid JSON');
		await expect(worker.repositories(fixture.repo)).rejects.toThrow();
		fixture.write(
			'twiki.config.json',
			JSON.stringify({ version: 1, contentDir: 'content', discovery: 'filesystem' })
		);
		expect(await worker.repositories(fixture.repo)).toEqual([]);
	} finally {
		exec.mockRestore();
		worker.close();
		rmSync(fixture.repo, { recursive: true, force: true });
	}
});
