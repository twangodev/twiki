import { expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { contentSourceReader } from '../../tooling/lib/content-source';
import { contentHash } from '../../tooling/lib/content-cache';

test('source keys reuse observed identities without retaining Markdown and reject edits, replacement, path and renderer changes', () => {
	const root = fs.mkdtempSync(path.join(tmpdir(), 'twiki-source-keys-'));
	const file = path.join(root, 'note.md');
	const source = (rel = 'course/note.md') => ({
		abs: file,
		rel,
		stat: fs.lstatSync(file, { bigint: true })
	});
	const read = (renderer = 'renderer', rel?: string, reuse = true) => {
		const current = source(rel);
		return contentSourceReader([current], renderer, reuse)(current);
	};
	try {
		fs.writeFileSync(file, '# Original');
		const initial = read();
		expect(initial.raw).toBe('# Original');
		expect(initial.parseKey).toBe(contentHash('renderer|course/note.md|# Original'));
		const spy = spyOn(fs, 'readFileSync');
		try {
			expect(read()).toEqual({ parseKey: initial.parseKey, raw: undefined });
			expect(spy.mock.calls).toHaveLength(0);
			expect(read('renderer', undefined, false).raw).toBe('# Original');
			expect(spy.mock.calls).toHaveLength(1);
		} finally {
			spy.mockRestore();
		}
		const stamp = fs.statSync(file);
		fs.writeFileSync(file, '# Modified');
		fs.utimesSync(file, stamp.atime, stamp.mtime);
		expect(read().parseKey).not.toBe(initial.parseKey);
		fs.writeFileSync(file + '.saving', '# Replaced');
		fs.renameSync(file + '.saving', file);
		expect(read().raw).toBe('# Replaced');
		const replaced = read().parseKey;
		expect(read('new renderer').parseKey).not.toBe(replaced);
		expect(read('new renderer', 'different/note.md').raw).toBe('# Replaced');
	} finally {
		contentSourceReader([], 'renderer', true);
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('source selections release obsolete key observations', () => {
	const root = fs.mkdtempSync(path.join(tmpdir(), 'twiki-source-selection-'));
	const file = path.join(root, 'note.md');
	try {
		fs.writeFileSync(file, '# Note');
		const source = { abs: file, rel: 'note.md', stat: fs.lstatSync(file, { bigint: true }) };
		contentSourceReader([source], 'renderer', true)(source);
		contentSourceReader([], 'renderer', true);
		const spy = spyOn(fs, 'readFileSync');
		try {
			expect(contentSourceReader([source], 'renderer', true)(source).raw).toBe('# Note');
			expect(spy.mock.calls).toHaveLength(1);
		} finally {
			spy.mockRestore();
		}
	} finally {
		contentSourceReader([], 'renderer', true);
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('explicit change hints reread only dirty notes when filesystem identities collide', () => {
	const root = fs.mkdtempSync(path.join(tmpdir(), 'twiki-source-collision-'));
	const changed = path.join(root, 'changed.md');
	const untouched = path.join(root, 'untouched.md');
	try {
		fs.writeFileSync(changed, '# Before');
		fs.writeFileSync(untouched, '# Untouched');
		const sources = [changed, untouched].map((abs) => ({
			abs,
			rel: path.basename(abs),
			stat: fs.lstatSync(abs, { bigint: true })
		}));
		const initial = contentSourceReader(sources, 'renderer', true);
		const previous = initial(sources[0]);
		const stable = initial(sources[1]);
		fs.writeFileSync(changed, '# After!');
		// Some filesystems report the same identity for rapid equal-size writes.
		// Retain that original observation to exercise the collision deterministically.
		const read = contentSourceReader(sources, 'renderer', true, new Set([changed]));
		const spy = spyOn(fs, 'readFileSync');
		try {
			const next = read(sources[0]);
			expect(next.raw).toBe('# After!');
			expect(next.parseKey).not.toBe(previous.parseKey);
			expect(next.parseKey).toBe(contentHash('renderer|changed.md|# After!'));
			expect(read(sources[1])).toEqual({ parseKey: stable.parseKey, raw: undefined });
			expect(spy.mock.calls).toHaveLength(1);
		} finally {
			spy.mockRestore();
		}
	} finally {
		contentSourceReader([], 'renderer', true);
		fs.rmSync(root, { recursive: true, force: true });
	}
});
