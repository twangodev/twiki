import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { publicationFixture } from '../publication-fixture';
import { nestedPublicationFixture } from '../nested-publication-fixture';
import { contentInputFingerprint, contentOutputFingerprint } from '../../tooling/lib/dev-state';
import { contentGit, contentRepositories } from '../../tooling/lib/dev-git-state';

test('startup snapshots detect offline edits, tracking changes, tooling changes and lost output', () => {
	const fixture = publicationFixture();
	try {
		const fingerprint = () => contentInputFingerprint(fixture.repo, 'tooling-v1');
		const original = fingerprint();
		expect(fingerprint()).toBe(original);
		fixture.write('content/sp99-cs101/notes/public.md', fixture.publicNote + '\nOffline edit');
		const edited = fingerprint();
		expect(edited).not.toBe(original);
		fixture.write('content/sp99-cs101/notes/new.md', '# New');
		const untracked = fingerprint();
		execFileSync('git', ['-C', fixture.course, 'add', 'notes/new.md']);
		expect(fingerprint()).not.toBe(untracked);
		expect(contentInputFingerprint(fixture.repo, 'tooling-v2')).not.toBe(fingerprint());
		const beforeDelete = fingerprint();
		rmSync(path.join(fixture.course, 'notes/public.md'));
		expect(fingerprint()).not.toBe(beforeDelete);
		const site = path.join(fixture.repo, 'site');
		const pages = path.join(site, 'build/generated/pages');
		mkdirSync(pages, { recursive: true });
		const page = path.join(pages, 'example.json');
		writeFileSync(page, '{}');
		const outputs = contentOutputFingerprint(site);
		expect(contentOutputFingerprint(site)).toBe(outputs);
		writeFileSync(path.join(site, 'build/generated/dev-state.json'), '{}');
		expect(contentOutputFingerprint(site)).toBe(outputs);
		rmSync(page);
		expect(contentOutputFingerprint(site)).not.toBe(outputs);
	} finally {
		rmSync(fixture.repo, { recursive: true, force: true });
	}
});

test('startup snapshots follow nested repositories through offline edits, HEAD and registration changes', () => {
	const fixture = publicationFixture();
	try {
		const { nested, git } = nestedPublicationFixture(fixture);
		const fingerprint = () => contentInputFingerprint(fixture.repo, 'tooling-v1');
		const recursiveFiles = () =>
			contentGit(
				'-C',
				fixture.repo,
				'ls-files',
				'--recurse-submodules',
				'--',
				'content'
			).toString();
		expect(contentRepositories(fixture.repo).map((repository) => repository.directory)).toEqual([
			fixture.repo,
			fixture.course,
			nested
		]);
		expect(recursiveFiles()).toContain('projects/nested.md');
		const original = fingerprint();
		expect(fingerprint()).toBe(original);
		fixture.write(
			'content/sp99-cs101/projects/nested.md',
			'# Nested project\n\nOffline nested edit.'
		);
		const edited = fingerprint();
		expect(edited).not.toBe(original);
		git(nested, 'commit', '--allow-empty', '-m', 'Change nested HEAD without changing its index');
		const committed = fingerprint();
		expect(committed).not.toBe(edited);
		git(fixture.course, 'config', 'submodule.projects.active', 'false');
		expect(recursiveFiles()).not.toContain('projects/nested.md');
		const unregistered = fingerprint();
		expect(unregistered).not.toBe(committed);
		// An initialized inactive clone still needs offline edits detected before it is re-enabled.
		rmSync(path.join(nested, 'nested.md'));
		expect(fingerprint()).not.toBe(unregistered);
		git(fixture.course, 'config', 'submodule.projects.active', 'true');
		expect(recursiveFiles()).toContain('projects/nested.md');
		const registered = fingerprint();
		fixture.write(
			'content/sp99-cs101/.gitmodules',
			'[submodule "projects"]\n\tpath = projects\n\turl = https://example.invalid/changed.git\n'
		);
		expect(fingerprint()).not.toBe(registered);
	} finally {
		rmSync(fixture.repo, { recursive: true, force: true });
	}
});

test('declared initialized courses are fingerprinted before their root gitlink is staged', () => {
	const fixture = publicationFixture();
	try {
		execFileSync('git', ['-C', fixture.repo, 'rm', '--cached', 'content/sp99-cs101']);
		const fingerprint = () => contentInputFingerprint(fixture.repo, 'tooling-v1');
		expect(contentRepositories(fixture.repo).map((repository) => repository.directory)).toEqual([
			fixture.repo,
			fixture.course
		]);
		const original = fingerprint();
		fixture.write(
			'content/sp99-cs101/notes/public.md',
			fixture.publicNote + '\nUnindexed course edit'
		);
		expect(fingerprint()).not.toBe(original);
	} finally {
		rmSync(fixture.repo, { recursive: true, force: true });
	}
});
