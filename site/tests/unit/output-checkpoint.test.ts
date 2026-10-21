import { expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import * as readAPI from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { OutputCheckpoint } from '../../tooling/lib/output-checkpoint';
import { recordOutput, trackOutputs, writeChanged } from '../../tooling/lib/output';

function fixture() {
	const site = fs.mkdtempSync(path.join(tmpdir(), 'twiki-output-checkpoint-'));
	const roots = ['manifest.json', 'pages', 'static'];
	const file = (relative: string) => path.join(site, relative);
	const info = (relative: string) => fs.lstatSync(file(relative), { bigint: true });
	const capture = () => OutputCheckpoint.capture(site, roots);
	const write = (relative: string, bytes = 'bytes') => {
		fs.mkdirSync(path.dirname(file(relative)), { recursive: true });
		fs.writeFileSync(file(relative), bytes);
		return info(relative);
	};
	return {
		site,
		roots,
		file,
		info,
		capture,
		write,
		cleanup: () => fs.rmSync(site, { recursive: true, force: true })
	};
}

test('managed missing roots, empty roots and symlinks remain distinct, without following symlink targets', () => {
	const f = fixture();
	try {
		const missing = f.capture().checkpoint.fingerprint();
		fs.mkdirSync(f.file('pages'));
		const snapshot = f.capture();
		expect(snapshot.checkpoint.fingerprint()).not.toBe(missing);
		fs.mkdirSync(f.file('pages/empty'));
		expect(f.capture().checkpoint.fingerprint()).toBe(snapshot.checkpoint.fingerprint());
		const target = fs.mkdtempSync(path.join(tmpdir(), 'twiki-checkpoint-target-'));
		try {
			fs.writeFileSync(path.join(target, 'private'), 'private');
			fs.symlinkSync(target, f.file('pages/link'));
			const linked = f.capture();
			expect([...linked.files.keys()]).not.toContain(path.join(target, 'private'));
			fs.writeFileSync(path.join(target, 'private'), 'changed target');
			expect(f.capture().checkpoint.fingerprint()).toBe(linked.checkpoint.fingerprint());
			fs.rmSync(f.file('pages'), { recursive: true });
			fs.symlinkSync(target, f.file('pages'));
			snapshot.checkpoint.record(f.file('pages'), f.info('pages'));
			expect(snapshot.checkpoint.fingerprint()).toBe(f.capture().checkpoint.fingerprint());
		} finally {
			fs.rmSync(target, { recursive: true, force: true });
		}
	} finally {
		f.cleanup();
	}
});

test('owned writes, atomic replacements, removals and root type changes match independent fresh captures', () => {
	const f = fixture();
	try {
		const { checkpoint } = f.capture();
		const check = () => expect(checkpoint.fingerprint()).toBe(f.capture().checkpoint.fingerprint());
		for (const relative of ['manifest.json', 'pages/nested/note.json', 'static/note.txt']) {
			checkpoint.record(f.file(relative), f.write(relative));
			check();
		}
		f.write('pages/nested/note.json.saving', 'changed');
		fs.renameSync(f.file('pages/nested/note.json.saving'), f.file('pages/nested/note.json'));
		checkpoint.record(f.file('pages/nested/note.json'), f.info('pages/nested/note.json'));
		check();
		fs.rmSync(f.file('pages/nested'), { recursive: true });
		checkpoint.remove(f.file('pages/nested'));
		check();
		fs.rmSync(f.file('manifest.json'));
		fs.mkdirSync(f.file('manifest.json'));
		checkpoint.record(f.file('manifest.json'), f.info('manifest.json'));
		check();
		checkpoint.record(f.file('manifest.json/child'), f.write('manifest.json/child'));
		check();
		fs.rmSync(f.file('manifest.json'), { recursive: true });
		checkpoint.record(f.file('manifest.json'), f.write('manifest.json', 'replacement root'));
		check();
		fs.rmSync(f.file('static'), { recursive: true });
		checkpoint.remove(f.file('static'));
		check();
	} finally {
		f.cleanup();
	}
});

test('unknown external edits do not become trusted through newer observations', () => {
	const f = fixture();
	try {
		f.write('pages/note.json', 'original');
		const { checkpoint } = f.capture();
		const original = checkpoint.fingerprint();
		expect(checkpoint.matchesCurrent()).toBe(true);
		const observed = f.info('pages/note.json');
		f.write('pages/note.json', 'unreported change');
		expect(checkpoint.matchesCurrent()).toBe(false);
		expect(checkpoint.fingerprint()).toBe(original);
		checkpoint.record(f.file('pages/note.json'), observed);
		expect(checkpoint.fingerprint()).toBe(original);
		expect(f.capture().checkpoint.fingerprint()).not.toBe(original);
		checkpoint.record(f.file('pages/note.json'), f.info('pages/note.json'));
		expect(checkpoint.fingerprint()).toBe(f.capture().checkpoint.fingerprint());
		f.write('static/unreported.txt');
		expect(checkpoint.matchesCurrent()).toBe(false);
		expect(checkpoint.fingerprint()).not.toBe(f.capture().checkpoint.fingerprint());
	} finally {
		f.cleanup();
	}
});

test('an unchanged write retains its pre-read observation if another writer mutates the file afterward', async () => {
	const f = fixture();
	try {
		f.write('pages/note.json', 'original');
		const { checkpoint } = f.capture();
		const original = checkpoint.fingerprint();
		const file = f.file('pages/note.json');
		const read = readAPI.readFileSync;
		const spy = spyOn(readAPI, 'readFileSync').mockImplementation((...args: any[]) => {
			const bytes = (read as any)(...args);
			if (String(args[0]) === file) fs.writeFileSync(file, 'unreported edit after validation');
			return bytes;
		});
		try {
			await trackOutputs(async () => writeChanged(file, 'original'), new Set(), checkpoint);
		} finally {
			spy.mockRestore();
		}
		expect(checkpoint.fingerprint()).toBe(original);
		expect(f.capture().checkpoint.fingerprint()).not.toBe(original);
	} finally {
		f.cleanup();
	}
});

test('hardlink additions refresh every known alias and removals require observation of surviving aliases', () => {
	const f = fixture();
	try {
		f.write('pages/original');
		fs.mkdirSync(f.file('static'));
		const { checkpoint } = f.capture();
		fs.linkSync(f.file('pages/original'), f.file('static/alias'));
		checkpoint.record(f.file('static/alias'), f.info('static/alias'));
		expect(checkpoint.fingerprint()).toBe(f.capture().checkpoint.fingerprint());
		fs.rmSync(f.file('static/alias'));
		checkpoint.remove(f.file('static/alias'));
		expect(checkpoint.complete).toBe(false);
		expect(() => checkpoint.fingerprint()).toThrow('unobserved hardlink');
		checkpoint.record(f.file('pages/original'), f.info('pages/original'));
		expect(checkpoint.complete).toBe(true);
		expect(checkpoint.fingerprint()).toBe(f.capture().checkpoint.fingerprint());
		fs.linkSync(f.file('pages/original'), f.file('static/alias'));
		checkpoint.record(f.file('static/alias'), f.info('static/alias'));
		fs.rmSync(f.file('pages/original'));
		checkpoint.remove(f.file('pages/original'));
		fs.rmSync(f.file('static/alias'));
		checkpoint.remove(f.file('static/alias'));
		expect(checkpoint.complete).toBe(true);
		expect(checkpoint.fingerprint()).toBe(f.capture().checkpoint.fingerprint());
	} finally {
		f.cleanup();
	}
});

test('atomic replacement of one hardlink conservatively tracks the old surviving inode', () => {
	const f = fixture();
	try {
		f.write('pages/original');
		fs.mkdirSync(f.file('static'));
		fs.linkSync(f.file('pages/original'), f.file('static/alias'));
		const { checkpoint } = f.capture();
		f.write('pages/temp', 'new bytes');
		fs.renameSync(f.file('pages/temp'), f.file('pages/original'));
		checkpoint.record(f.file('pages/original'), f.info('pages/original'));
		expect(checkpoint.complete).toBe(false);
		checkpoint.record(f.file('static/alias'), f.info('static/alias'));
		expect(checkpoint.fingerprint()).toBe(f.capture().checkpoint.fingerprint());
	} finally {
		f.cleanup();
	}
});

test('checkpoint roots reject traversal, overlap and out-of-scope observations', () => {
	const f = fixture();
	try {
		expect(() => new OutputCheckpoint(f.site, ['../outside'])).toThrow('Invalid');
		expect(() => new OutputCheckpoint(f.site, ['pages', 'pages/nested'])).toThrow('overlap');
		const { checkpoint } = f.capture();
		const original = checkpoint.fingerprint();
		const info = f.write('outside.txt');
		checkpoint.record(f.file('outside.txt'), info);
		checkpoint.remove(f.file('outside.txt'));
		expect(checkpoint.handles(f.file('outside.txt'))).toBe(false);
		expect(checkpoint.fingerprint()).toBe(original);
	} finally {
		f.cleanup();
	}
});

test('a known write cannot silently become an owned deletion when its output disappears', async () => {
	const f = fixture();
	try {
		const { checkpoint } = f.capture();
		await expect(
			trackOutputs(async () => recordOutput(f.file('pages/missing.json')), new Set(), checkpoint)
		).rejects.toThrow('disappeared before observation');
	} finally {
		f.cleanup();
	}
});

test('a file disappearing after directory enumeration rejects an unstable fresh capture', () => {
	const f = fixture();
	try {
		f.write('pages/racing.json');
		const target = f.file('pages/racing.json');
		const lstat = readAPI.lstatSync;
		const spy = spyOn(readAPI, 'lstatSync').mockImplementation((...args: any[]) => {
			if (String(args[0]) === target) {
				fs.rmSync(target, { force: true });
				return undefined;
			}
			return (lstat as any)(...args);
		});
		try {
			expect(() => f.capture()).toThrow('changed during checkpoint capture');
		} finally {
			spy.mockRestore();
		}
	} finally {
		f.cleanup();
	}
});

test('sentinel inode identifiers never merge independent files and force fresh capture for hardlink changes', () => {
	const f = fixture();
	const lstat = readAPI.lstatSync;
	const spy = spyOn(readAPI, 'lstatSync').mockImplementation((...args: any[]) => {
		const info = (lstat as any)(...args);
		if (info?.isFile()) Object.defineProperty(info, 'ino', { value: 0n });
		return info;
	});
	try {
		f.write('pages/first', 'first');
		f.write('pages/second', 'second');
		const original = f.capture().checkpoint.fingerprint();
		f.write('pages/first', 'changed first file');
		const { checkpoint } = f.capture();
		expect(checkpoint.fingerprint()).not.toBe(original);
		fs.mkdirSync(f.file('static'));
		fs.linkSync(f.file('pages/first'), f.file('static/alias'));
		checkpoint.record(
			f.file('static/alias'),
			readAPI.lstatSync(f.file('static/alias'), { bigint: true })
		);
		expect(checkpoint.complete).toBe(false);
		expect(f.capture().checkpoint.complete).toBe(true);
	} finally {
		spy.mockRestore();
		f.cleanup();
	}
});

test('bulk capture matches incremental assembly and retains hardlink groups for later writes', () => {
	const f = fixture();
	try {
		f.write('manifest.json');
		f.write('pages/deep/note.json');
		f.write('static/shared.txt');
		fs.linkSync(f.file('static/shared.txt'), f.file('pages/shared.txt'));
		fs.symlinkSync('../static/shared.txt', f.file('pages/link'));
		fs.mkdirSync(f.file('pages/empty'));
		const expected = new OutputCheckpoint(f.site, f.roots);
		const regular = [
			'manifest.json',
			'pages/deep/note.json',
			'static/shared.txt',
			'pages/shared.txt'
		];
		for (const relative of ['pages', 'static', ...regular, 'pages/link'])
			expected.record(f.file(relative), f.info(relative));
		const bulk = f.capture();
		expect(bulk.checkpoint.fingerprint()).toBe(expected.fingerprint());
		expect([...bulk.files.keys()].sort()).toEqual(regular.map(f.file).sort());
		const changed = f.write('static/shared.txt', 'Changed through a shared inode');
		expected.record(f.file('static/shared.txt'), changed);
		bulk.checkpoint.record(f.file('static/shared.txt'), changed);
		expect(bulk.checkpoint.fingerprint()).toBe(expected.fingerprint());
		expect(bulk.checkpoint.fingerprint()).toBe(f.capture().checkpoint.fingerprint());
	} finally {
		f.cleanup();
	}
});
