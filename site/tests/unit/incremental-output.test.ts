import { expect, test, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import {
	mkdtempSync,
	mkdirSync,
	symlinkSync,
	readFileSync,
	statSync,
	linkSync,
	rmSync,
	existsSync,
	writeFileSync,
	utimesSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	writeChanged,
	copyChanged,
	pruneOutputs,
	trackOutputs,
	restoreCopy
} from '../../tooling/lib/output';
import { rebuildQueue } from '../../tooling/lib/rebuild-queue';

test('copy results report emitted byte sizes for empty and transformed outputs, including reuse', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'twiki-copy-sizes-'));
	const source = path.join(root, 'source');
	const output = path.join(root, 'output');
	try {
		writeFileSync(source, '');
		expect(copyChanged(source, output, true)).toBe(0);
		expect(copyChanged(source, output, true)).toBe(0);
		writeFileSync(source, 'input with a different byte length');
		const transform = () => Buffer.from('界');
		expect(copyChanged(source, output, true, transform)).toBe(3);
		expect(copyChanged(source, output, true, transform)).toBe(3);
		expect(readFileSync(output, 'utf8')).toBe('界');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('restored copies skip validated bytes but reject source and output edits made after observation', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'twiki-restored-copy-'));
	const source = path.join(root, 'source');
	const output = path.join(root, 'output');
	try {
		writeFileSync(source, 'original');
		writeFileSync(output, 'original');
		const input = statSync(source, { bigint: true });
		const generated = statSync(output, { bigint: true });
		const read = spyOn(fs, 'readFileSync');
		try {
			restoreCopy(source, output, input, generated);
			copyChanged(source, output, true);
			expect(read.mock.calls).toHaveLength(0);
			writeFileSync(source, 'edited after observation');
			restoreCopy(source, output, input, generated);
			copyChanged(source, output, true);
			expect(readFileSync(output, 'utf8')).toBe('edited after observation');
			const currentInput = statSync(source, { bigint: true });
			const currentOutput = statSync(output, { bigint: true });
			writeFileSync(output, 'corrupt output');
			restoreCopy(source, output, currentInput, currentOutput);
			copyChanged(source, output, true);
			expect(readFileSync(output, 'utf8')).toBe('edited after observation');
		} finally {
			read.mockRestore();
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a changed source reader must validate previously copied bytes before reuse', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'twiki-copy-validation-'));
	const source = path.join(root, 'source');
	const output = path.join(root, 'output');
	try {
		writeFileSync(source, 'unchecked');
		copyChanged(source, output, true);
		let reads = 0;
		expect(
			copyChanged(source, output, true, () => {
				reads++;
				return undefined;
			})
		).toBeUndefined();
		expect(reads).toBe(1);
		expect(readFileSync(output, 'utf8')).toBe('unchecked');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('development asset reuse detects equal-size edits, restored mtimes, output corruption and deletion', async () => {
	const root = mkdtempSync(path.join(tmpdir(), 'twiki-asset-reuse-'));
	const source = path.join(root, 'source');
	const destination = path.join(root, 'output');
	try {
		writeFileSync(source, 'before');
		copyChanged(source, destination, true);
		const original = statSync(source);
		const output = statSync(destination);
		expect((await trackOutputs(async () => copyChanged(source, destination, true))).size).toBe(0);
		expect(statSync(destination).ino).toBe(output.ino);
		writeFileSync(source, 'after!');
		utimesSync(source, original.atime, original.mtime);
		expect([...(await trackOutputs(async () => copyChanged(source, destination, true)))]).toEqual([
			destination
		]);
		expect(readFileSync(destination, 'utf8')).toBe('after!');
		const copied = statSync(destination);
		writeFileSync(destination, 'broken');
		utimesSync(destination, copied.atime, copied.mtime);
		copyChanged(source, destination, true);
		expect(readFileSync(destination, 'utf8')).toBe('after!');
		rmSync(destination);
		copyChanged(source, destination, true);
		expect(readFileSync(destination, 'utf8')).toBe('after!');
		const other = path.join(root, 'other');
		writeFileSync(other, 'other!');
		copyChanged(other, destination, true);
		expect(readFileSync(destination, 'utf8')).toBe('other!');
		copyChanged(source, destination);
		expect(readFileSync(destination, 'utf8')).toBe('after!');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('incremental outputs preserve unchanged files and replace hardlinks without modifying readers', async () => {
	const root = mkdtempSync(path.join(tmpdir(), 'wisconsin-output-'));
	try {
		const file = path.join(root, 'note.json');
		const linked = path.join(root, 'served.json');
		writeChanged(file, 'before');
		linkSync(file, linked);
		const before = statSync(file);
		const unchanged = await trackOutputs(async () => {
			writeChanged(file, 'before');
		});
		expect(unchanged.size).toBe(0);
		expect(statSync(file).mtimeMs).toBe(before.mtimeMs);
		expect(statSync(file).ino).toBe(before.ino);
		const changed = await trackOutputs(async () => {
			writeChanged(file, 'after');
		});
		expect([...changed]).toEqual([file]);
		expect(readFileSync(linked, 'utf8')).toBe('before');
		expect(readFileSync(file, 'utf8')).toBe('after');
		const removed = await trackOutputs(async () => {
			pruneOutputs(root, new Set([file]));
		});
		expect([...removed]).toEqual([linked]);
		expect(existsSync(linked)).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('pruning removes stale nested outputs, preserves protected trees, and never follows symlinks', async () => {
	const root = mkdtempSync(path.join(tmpdir(), 'twiki-prune-'));
	const output = path.join(root, 'output');
	const keep = path.join(output, 'keep/deep/note.txt');
	const stale = path.join(output, 'stale/deep/note.txt');
	const protectedTree = path.join(output, 'fonts');
	const outside = path.join(root, 'outside.txt');
	try {
		writeChanged(keep, 'keep');
		writeChanged(stale, 'stale');
		writeChanged(path.join(protectedTree, 'font.woff2'), 'font');
		mkdirSync(path.join(protectedTree, 'empty'));
		mkdirSync(path.join(output, 'empty/deep'), { recursive: true });
		writeFileSync(outside, 'outside');
		const link = path.join(output, 'stale-link');
		symlinkSync(outside, link);
		let removed = 0;
		const changed = await trackOutputs(async () => {
			removed = pruneOutputs(output, new Set([keep]), (file) => file === protectedTree);
		});
		expect(removed).toBe(2);
		expect([...changed].sort()).toEqual([stale, link].sort());
		expect(readFileSync(keep, 'utf8')).toBe('keep');
		expect(readFileSync(outside, 'utf8')).toBe('outside');
		expect(existsSync(path.join(output, 'stale'))).toBe(false);
		expect(existsSync(path.join(output, 'empty'))).toBe(false);
		expect(existsSync(path.join(protectedTree, 'empty'))).toBe(true);
		expect(pruneOutputs(output, new Set([keep]), (file) => file === protectedTree)).toBe(0);
		expect(pruneOutputs(path.join(root, 'missing'), new Set())).toBe(0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a reconciliation collector retains writes from a failed pass when recovery preserves their bytes', async () => {
	const root = mkdtempSync(path.join(tmpdir(), 'twiki-output-reconcile-'));
	const file = path.join(root, 'page.json');
	const outputs = new Set<string>();
	try {
		await expect(
			trackOutputs(async () => {
				writeChanged(file, 'new page');
				throw new Error('Inputs changed');
			}, outputs)
		).rejects.toThrow('Inputs changed');
		const recovered = await trackOutputs(async () => writeChanged(file, 'new page'), outputs);
		expect([...recovered]).toEqual([file]);
		expect(readFileSync(file, 'utf8')).toBe('new page');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('an idle burst yields once, coalesces edits, and can run again after failure', async () => {
	let runs = 0;
	const queue = rebuildQueue(async () => {
		runs++;
		if (runs === 1) throw new Error('failed content build');
	});
	for (let i = 0; i < 20; i++) queue.schedule();
	expect(runs).toBe(0);
	await Promise.resolve();
	queue.schedule();
	expect(runs).toBe(0);
	await expect(queue.wait()).rejects.toThrow('failed content build');
	expect(runs).toBe(1);
	queue.schedule();
	await queue.wait();
	expect(runs).toBe(2);
});

test('a burst during a running content build produces only one follow-up', async () => {
	let release!: () => void;
	let started!: () => void;
	const active = new Promise<void>((resolve) => {
		started = resolve;
	});
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	let runs = 0;
	const queue = rebuildQueue(async () => {
		runs++;
		if (runs === 1) {
			started();
			await blocked;
		}
	}, 0);
	queue.schedule();
	queue.schedule();
	await active;
	for (let i = 0; i < 20; i++) queue.schedule();
	release();
	await queue.wait();
	expect(runs).toBe(2);
});
