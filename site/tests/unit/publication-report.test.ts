import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveProject } from '../../tooling/lib/project-config';
import { publicationReport } from '../../tooling/publish';
import { publicationFixture } from '../publication-fixture';

test('reports a configured Git-free vault while excluding hidden inputs and symlinks', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'twiki-publication-report-'));
	try {
		mkdirSync(path.join(root, 'vault/nested'), { recursive: true });
		writeFileSync(
			path.join(root, 'twiki.config.json'),
			JSON.stringify({
				version: 1,
				contentDir: 'vault',
				publication: 'public',
				discovery: 'filesystem'
			})
		);
		writeFileSync(path.join(root, 'vault/home.md'), '# Home');
		writeFileSync(path.join(root, 'vault/nested/note.md'), '# Note');
		writeFileSync(path.join(root, 'vault/.env'), 'secret');
		symlinkSync(path.join(root, 'twiki.config.json'), path.join(root, 'vault/link.md'));
		const project = resolveProject('/unused/engine', root, { TWIKI_PROJECT_ROOT: root });
		expect(
			publicationReport(project).map(({ path, public: published }) => [path, published])
		).toEqual([
			['home.md', true],
			['nested/note.md', true]
		]);
		expect(publicationReport(project, 'nested').map((entry) => entry.path)).toEqual([
			'nested/note.md'
		]);
		expect(
			publicationReport({ ...project, publication: 'private' }).every((entry) => !entry.public)
		).toBe(true);
		const git = (...args: string[]) =>
			execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
		git('init');
		git('add', 'vault/home.md');
		expect(publicationReport({ ...project, discovery: 'git' }).map((entry) => entry.path)).toEqual([
			'home.md'
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('reports nested Git course policies using the compiler publication decisions', () => {
	const fixture = publicationFixture();
	try {
		const project = resolveProject('/unused/engine', fixture.repo, {
			TWIKI_CONTENT_REPO: fixture.repo
		});
		const entries = publicationReport(project);
		expect(entries.find((entry) => entry.path === 'sp99-cs101/notes/public.md')?.public).toBe(true);
		expect(entries.find((entry) => entry.path === 'sp99-cs101/notes/slides.md')?.public).toBe(
			false
		);
		expect(entries.find((entry) => entry.path === 'index.md')?.public).toBe(false);
		expect(
			publicationReport(project, 'sp99-cs101/notes').every((entry) =>
				entry.path.startsWith('sp99-cs101/notes/')
			)
		).toBe(true);
	} finally {
		rmSync(fixture.repo, { recursive: true, force: true });
	}
});
