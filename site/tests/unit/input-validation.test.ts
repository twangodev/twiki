import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { freshInputFingerprint } from '../../tooling/lib/input-validation';
import { contentInputFingerprint } from '../../tooling/lib/dev-state';
import { withSourceDiscovery } from '../../tooling/lib/project-config';

test('disposable source validators observe current bytes, structure and configuration', async () => {
	const root = mkdtempSync(path.join(tmpdir(), 'twiki-input-validation-'));
	try {
		mkdirSync(path.join(root, 'notes'));
		const config = path.join(root, 'twiki.config.json');
		writeFileSync(
			config,
			JSON.stringify({ version: 1, contentDir: 'notes', discovery: 'filesystem' })
		);
		const note = path.join(root, 'notes/note.md');
		writeFileSync(note, '# Original');
		const capture = () => withSourceDiscovery(() => contentInputFingerprint(root, 'engine'));
		const original = await capture();
		expect(await freshInputFingerprint(root, 'engine')).toBe(original);
		const stamp = statSync(note);
		writeFileSync(note, '# Replaced');
		utimesSync(note, stamp.atime, stamp.mtime);
		const edited = await freshInputFingerprint(root, 'engine');
		expect(edited).not.toBe(original);
		expect(edited).toBe(await capture());
		writeFileSync(path.join(root, 'notes/new.md'), '# Added without an editor hint');
		const added = await freshInputFingerprint(root, 'engine');
		expect(added).not.toBe(edited);
		expect(added).toBe(await capture());
		writeFileSync(
			config,
			JSON.stringify({
				version: 1,
				contentDir: 'notes',
				discovery: 'filesystem',
				publication: 'public'
			})
		);
		const policy = await freshInputFingerprint(root, 'engine');
		expect(policy).not.toBe(added);
		expect(policy).toBe(await capture());
		let completeBuild!: () => void;
		const build = new Promise<void>((resolve) => {
			completeBuild = resolve;
		});
		let settled = false;
		const pending = freshInputFingerprint(root, 'engine', build).then((value) => {
			settled = true;
			return value;
		});
		try {
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(settled).toBe(false);
			writeFileSync(note, '# Written while compilation was active');
		} finally {
			completeBuild();
		}
		expect(await freshInputFingerprint(root, 'engine', Promise.resolve(false))).toBeUndefined();
		const afterBuild = await pending;
		expect(afterBuild).not.toBe(policy);
		expect(afterBuild).toBe(await capture());
		expect(
			await freshInputFingerprint(root, 'engine', Promise.reject(new Error('failed build')))
		).toBeUndefined();
		rmSync(path.join(root, 'notes'), { recursive: true });
		expect(await freshInputFingerprint(root, 'engine')).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
