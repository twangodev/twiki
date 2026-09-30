import { expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildRmdPreviews } from '../../tooling/lib/rmd-previews';
import type { CourseFile } from '../../src/lib/files';

test.each(['missing executable', 'missing knitr'])(
	'%s warns and clears stale build previews',
	async (failure) => {
		const scratch = mkdtempSync(path.join(tmpdir(), 'wisconsin-rmd-runtime-'));
		const previous = process.env.RSCRIPT;
		process.env.RSCRIPT = path.join(scratch, 'Rscript');
		if (failure === 'missing knitr')
			writeFileSync(
				process.env.RSCRIPT,
				'#!/bin/sh\necho "there is no package called knitr" >&2\nexit 1\n',
				{ mode: 0o755 }
			);
		const warn = spyOn(console, 'warn').mockImplementation(() => {});
		const files: CourseFile[] = [
			{
				path: 'worksheet.Rmd',
				kind: 'text',
				size: 10,
				download: '/_files/blobs/source.bin',
				rmdPreview: '/stale-preview.json'
			}
		];
		const retain = () => {
			throw new Error('Must not emit without R');
		};
		try {
			await buildRmdPreviews('/unused', 'test', files, '/unused', retain);
			expect(files[0].rmdPreview).toBeUndefined();
			expect(files[0].download).toBe('/_files/blobs/source.bin');
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining('Using Source and Interactive views.')
			);
		} finally {
			warn.mockRestore();
			if (previous === undefined) delete process.env.RSCRIPT;
			else process.env.RSCRIPT = previous;
			rmSync(scratch, { recursive: true, force: true });
		}
	}
);
