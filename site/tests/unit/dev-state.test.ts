import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { publicationFixture } from '../publication-fixture';
import { contentInputFingerprint, contentOutputFingerprint } from '../../tooling/lib/dev-state';

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
