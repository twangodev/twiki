import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, statSync, linkSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeChanged, pruneOutputs, trackOutputs } from '../../tooling/lib/output';
import { rebuildQueue } from '../../tooling/lib/rebuild-queue';

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
