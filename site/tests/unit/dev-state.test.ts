import { expect, test, spyOn } from 'bun:test';
import { execFileSync } from 'node:child_process';
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { publicationFixture } from '../publication-fixture';
import { nestedPublicationFixture } from '../nested-publication-fixture';
import {
	captureContentInputs,
	captureContentOutputs,
	contentInputFingerprint,
	contentOutputFingerprint
} from '../../tooling/lib/dev-state';
import { resolveProject, withSourceDiscovery } from '../../tooling/lib/project-config';
import { contentGit, contentRepositories } from '../../tooling/lib/dev-git-state';

test('output snapshots retain the exact validated file identities without observing newer edits', async () => {
	const fixture = publicationFixture();
	try {
		const site = path.join(fixture.repo, 'site');
		const file = path.join(site, 'build/generated/assets/image.svg');
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, 'original');
		const captured = captureContentOutputs(site);
		expect(captured.fingerprint).toBe(contentOutputFingerprint(site));
		expect(captured.files.get(file)?.size).toBe(8n);
		writeFileSync(file, 'changed after capture');
		expect(captured.files.get(file)?.size).toBe(8n);
		expect(captured.fingerprint).not.toBe(contentOutputFingerprint(site));
	} finally {
		rmSync(fixture.repo, { recursive: true, force: true });
	}
});

test('public development output validation includes its separate assets, course files and static tree', async () => {
	const fixture = publicationFixture();
	const edition = process.env.VITE_PUBLIC_EDITION;
	try {
		process.env.VITE_PUBLIC_EDITION = 'true';
		const site = path.join(fixture.repo, 'site');
		for (const directory of ['public-assets', 'public-files', 'public-static']) {
			const file = path.join(site, 'build/generated', directory, 'output.json');
			mkdirSync(path.dirname(file), { recursive: true });
			writeFileSync(file, 'before');
			const before = contentOutputFingerprint(site);
			writeFileSync(file, 'changed output');
			expect(contentOutputFingerprint(site)).not.toBe(before);
			rmSync(file);
			expect(contentOutputFingerprint(site)).not.toBe(before);
		}
	} finally {
		if (edition === undefined) delete process.env.VITE_PUBLIC_EDITION;
		else process.env.VITE_PUBLIC_EDITION = edition;
		rmSync(fixture.repo, { recursive: true, force: true });
	}
});

test.each(['git', 'filesystem'] as const)(
	'candidate %s snapshots match fresh captures for edits and atomic saves without querying Git',
	async (discovery) => {
		const fixture = publicationFixture();
		try {
			fixture.write(
				'twiki.config.json',
				JSON.stringify({ version: 1, contentDir: 'content', discovery })
			);
			const project = resolveProject(process.cwd(), fixture.repo);
			const note = path.join(fixture.course, 'notes/public.md');
			const first = await captureContentInputs(fixture.repo, 'engine');
			const stamp = fs.statSync(note);
			fixture.write('content/sp99-cs101/notes/public.md', fixture.publicNote + '\nEdited');
			fs.utimesSync(note, stamp.atime, stamp.mtime);
			const git = spyOn(childProcess, 'execFileSync');
			const asynchronous = spyOn(childProcess, 'execFile');
			let edited;
			try {
				edited = first.refresh(project, 'engine', new Set([note]))!;
				expect(git.mock.calls).toHaveLength(0);
				expect(asynchronous.mock.calls).toHaveLength(0);
			} finally {
				git.mockRestore();
				asynchronous.mockRestore();
			}
			expect(edited.fingerprint).not.toBe(first.fingerprint);
			expect(edited.fingerprint).toBe(
				(await captureContentInputs(fixture.repo, 'engine')).fingerprint
			);
			const rootNote = path.join(fixture.course, 'root.md');
			fixture.write('content/sp99-cs101/root.md', '# Before');
			if (discovery === 'git') execFileSync('git', ['-C', fixture.course, 'add', 'root.md']);
			const beforeAtomic = await captureContentInputs(fixture.repo, 'engine');
			fs.writeFileSync(rootNote + '.saving', '# After');
			fs.renameSync(rootNote + '.saving', rootNote);
			expect(beforeAtomic.refresh(project, 'engine', new Set([rootNote]))?.fingerprint).toBe(
				(await captureContentInputs(fixture.repo, 'engine')).fingerprint
			);
			expect(first.refresh(project, 'new-engine', new Set([note]))).toBeUndefined();
			expect(first.refresh(project, 'engine', new Set([fixture.course]))).toBeUndefined();
			expect(first.refresh(project, 'engine', new Set([rootNote]))).toBeUndefined();
			fs.rmSync(note);
			expect(first.refresh(project, 'engine', new Set([note]))).toBeUndefined();
			fs.symlinkSync(path.join(fixture.course, 'notes/second.md'), note);
			expect(first.refresh(project, 'engine', new Set([note]))).toBeUndefined();
		} finally {
			rmSync(fixture.repo, { recursive: true, force: true });
		}
	}
);

test('unreported source and Git changes disagree with a candidate and require reconciliation', async () => {
	const fixture = publicationFixture();
	try {
		const project = resolveProject(process.cwd(), fixture.repo);
		const snapshot = await captureContentInputs(fixture.repo, 'engine');
		const note = path.join(fixture.course, 'notes/public.md');
		fixture.write('content/sp99-cs101/notes/public.md', fixture.publicNote + '\nReported');
		fixture.write('content/sp99-cs101/notes/second.md', '# Unreported');
		expect(snapshot.refresh(project, 'engine', new Set([note]))?.fingerprint).not.toBe(
			(await captureContentInputs(fixture.repo, 'engine')).fingerprint
		);
		const baseline = await captureContentInputs(fixture.repo, 'engine');
		execFileSync('git', [
			'-C',
			fixture.course,
			'-c',
			'commit.gpgsign=false',
			'-c',
			'user.name=Fixture',
			'-c',
			'user.email=fixture@example.test',
			'commit',
			'--allow-empty',
			'-m',
			'Unreported HEAD'
		]);
		expect(baseline.refresh(project, 'engine', new Set([note]))?.fingerprint).not.toBe(
			(await captureContentInputs(fixture.repo, 'engine')).fingerprint
		);
	} finally {
		rmSync(fixture.repo, { recursive: true, force: true });
	}
});

test('each snapshot observes a shared tracked note once across discovery and fingerprinting', async () => {
	const fixture = publicationFixture();
	const note = path.join(fixture.course, 'notes/public.md');
	const stat = spyOn(fs, 'lstatSync');
	try {
		const first = await contentInputFingerprint(fixture.repo, 'tooling');
		expect(stat.mock.calls.filter(([file]) => file === note)).toHaveLength(1);
		stat.mockClear();
		fixture.write(
			'content/sp99-cs101/notes/public.md',
			fixture.publicNote + '\nChanged between snapshots'
		);
		expect(await contentInputFingerprint(fixture.repo, 'tooling')).not.toBe(first);
		expect(stat.mock.calls.filter(([file]) => file === note)).toHaveLength(1);
	} finally {
		stat.mockRestore();
		rmSync(fixture.repo, { recursive: true, force: true });
	}
});

test('a fresh validation scope sees edits made after the build discovery snapshot', async () => {
	const fixture = publicationFixture();
	try {
		const fingerprint = async () => await contentInputFingerprint(fixture.repo, 'tooling');
		await withSourceDiscovery(async () => {
			const original = await fingerprint();
			fixture.write('content/sp99-cs101/notes/public.md', fixture.publicNote + '\nDuring build');
			expect(await fingerprint()).toBe(original);
			expect(await withSourceDiscovery(fingerprint)).not.toBe(original);
		});
	} finally {
		rmSync(fixture.repo, { recursive: true, force: true });
	}
});

test('startup snapshots detect offline edits, tracking changes, tooling changes and lost output', async () => {
	const fixture = publicationFixture();
	try {
		const fingerprint = async () => await contentInputFingerprint(fixture.repo, 'tooling-v1');
		const original = await fingerprint();
		expect(await fingerprint()).toBe(original);
		fixture.write('content/sp99-cs101/notes/public.md', fixture.publicNote + '\nOffline edit');
		const edited = await fingerprint();
		expect(edited).not.toBe(original);
		fixture.write('content/sp99-cs101/notes/new.md', '# New');
		const untracked = await fingerprint();
		execFileSync('git', ['-C', fixture.course, 'add', 'notes/new.md']);
		expect(await fingerprint()).not.toBe(untracked);
		expect(await contentInputFingerprint(fixture.repo, 'tooling-v2')).not.toBe(await fingerprint());
		const beforeDelete = await fingerprint();
		rmSync(path.join(fixture.course, 'notes/public.md'));
		expect(await fingerprint()).not.toBe(beforeDelete);
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

test('startup snapshots follow nested repositories through offline edits, HEAD and registration changes', async () => {
	const fixture = publicationFixture();
	try {
		const { nested, git } = nestedPublicationFixture(fixture);
		const fingerprint = async () => await contentInputFingerprint(fixture.repo, 'tooling-v1');
		const recursiveFiles = async () =>
			(
				await contentGit('-C', fixture.repo, 'ls-files', '--recurse-submodules', '--', 'content')
			).toString();
		expect(
			(await contentRepositories(fixture.repo)).map((repository) => repository.directory)
		).toEqual([fixture.repo, fixture.course, nested]);
		expect(await recursiveFiles()).toContain('projects/nested.md');
		const original = await fingerprint();
		expect(await fingerprint()).toBe(original);
		fixture.write(
			'content/sp99-cs101/projects/nested.md',
			'# Nested project\n\nOffline nested edit.'
		);
		const edited = await fingerprint();
		expect(edited).not.toBe(original);
		git(nested, 'commit', '--allow-empty', '-m', 'Change nested HEAD without changing its index');
		const committed = await fingerprint();
		expect(committed).not.toBe(edited);
		git(fixture.course, 'config', 'submodule.projects.active', 'false');
		expect(await recursiveFiles()).not.toContain('projects/nested.md');
		const unregistered = await fingerprint();
		expect(unregistered).not.toBe(committed);
		// An initialized inactive clone still needs offline edits detected before it is re-enabled.
		rmSync(path.join(nested, 'nested.md'));
		expect(await fingerprint()).not.toBe(unregistered);
		git(fixture.course, 'config', 'submodule.projects.active', 'true');
		expect(await recursiveFiles()).toContain('projects/nested.md');
		const registered = await fingerprint();
		fixture.write(
			'content/sp99-cs101/.gitmodules',
			'[submodule "projects"]\n\tpath = projects\n\turl = https://example.invalid/changed.git\n'
		);
		expect(await fingerprint()).not.toBe(registered);
	} finally {
		rmSync(fixture.repo, { recursive: true, force: true });
	}
});

test('declared initialized courses are fingerprinted before their root gitlink is staged', async () => {
	const fixture = publicationFixture();
	try {
		execFileSync('git', ['-C', fixture.repo, 'rm', '--cached', 'content/sp99-cs101']);
		const fingerprint = async () => await contentInputFingerprint(fixture.repo, 'tooling-v1');
		expect(
			(await contentRepositories(fixture.repo)).map((repository) => repository.directory)
		).toEqual([fixture.repo, fixture.course]);
		const original = await fingerprint();
		fixture.write(
			'content/sp99-cs101/notes/public.md',
			fixture.publicNote + '\nUnindexed course edit'
		);
		expect(await fingerprint()).not.toBe(original);
	} finally {
		rmSync(fixture.repo, { recursive: true, force: true });
	}
});
