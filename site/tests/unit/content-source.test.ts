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
