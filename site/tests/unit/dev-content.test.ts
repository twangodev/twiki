import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { developmentContent } from '../../tooling/lib/dev-content';

test('development worker stays warm, propagates failure, restarts after exit, and closes pending work', async () => {
	const site = mkdtempSync(path.join(tmpdir(), 'twiki-dev-worker-'));
	mkdirSync(path.join(site, 'tooling'));
	writeFileSync(
		path.join(site, 'tooling/dev-content-worker.ts'),
		`
let count = 0;
process.on('message', ({ id, inputs }) => {
  if (inputs?.includes('exit')) process.exit(17);
  if (inputs?.includes('wait')) return;
  if (inputs?.includes('error')) return process.send({ id, error: 'rebuild failed' });
  process.send({ id, files: [String(++count), ...(inputs ?? [])] });
});
process.on('disconnect', () => process.exit(0));
`
	);
	const worker = developmentContent(site);
	try {
		expect(await worker.prepare(true)).toEqual(new Set(['1']));
		expect(await worker.prepare(false, new Set(['note.md']))).toEqual(new Set(['2', 'note.md']));
		await expect(worker.prepare(false, new Set(['error']))).rejects.toThrow('rebuild failed');
		expect(await worker.prepare(false)).toEqual(new Set(['3']));
		await expect(worker.prepare(false, new Set(['exit']))).rejects.toThrow(
			'Content worker exited (17)'
		);
		expect(await worker.prepare(true)).toEqual(new Set(['1']));
		const pending = worker.prepare(false, new Set(['wait']));
		void pending.catch(() => {});
		worker.close();
		await expect(pending).rejects.toThrow('Content worker is closed');
		await expect(worker.prepare(true)).rejects.toThrow('Content worker is closed');
	} finally {
		worker.close();
		rmSync(site, { recursive: true, force: true });
	}
});
