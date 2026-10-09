import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CourseFile } from '../../src/lib/files';
import { buildRmdPreviews } from '../../tooling/lib/rmd-previews';
import { rRuntimeVersion } from '../../tooling/lib/r-runtime';

const selectedExecutable = process.env.RSCRIPT ?? 'Rscript';
const executable = selectedExecutable.includes(path.sep)
	? path.resolve(selectedExecutable)
	: ((process.env.PATH ?? '')
			.split(path.delimiter)
			.map((directory) => path.resolve(directory, selectedExecutable))
			.find(existsSync) ?? selectedExecutable);
const available =
	spawnSync(
		executable,
		['--vanilla', '-e', 'quit(status = if (requireNamespace("knitr", quietly = TRUE)) 0 else 1)'],
		{ timeout: 30_000, stdio: 'pipe' }
	).status === 0;

test.skipIf(!available)(
	'unverified fonts render twice even with a complete preview cache in the same process',
	async () => {
		const site = mkdtempSync(path.join(tmpdir(), 'wisconsin-unverified-fonts-'));
		const output = path.join(site, 'output');
		const bin = path.join(site, 'bin');
		const renders = path.join(site, 'renders');
		const originalPath = process.env.PATH;
		const originalExecutable = process.env.RSCRIPT;
		const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
		try {
			mkdirSync(path.join(output, 'blobs'), { recursive: true });
			mkdirSync(bin);
			writeFileSync(path.join(bin, 'fc-list'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
			const wrapper = path.join(bin, 'Rscript');
			writeFileSync(
				wrapper,
				`#!/bin/sh\nif [ "$2" != "-e" ]; then echo render >> ${quote(renders)}; fi\nexec ${quote(executable)} "$@"\n`,
				{ mode: 0o755 }
			);
			process.env.PATH = `${bin}${path.delimiter}${originalPath ?? ''}`;
			process.env.RSCRIPT = wrapper;
			const code = '# Worksheet\n\n```{r}\n1 + 1\n```\n';
			const blob = `${createHash('sha256').update(code).digest('hex')}.bin`;
			writeFileSync(path.join(output, 'blobs', blob), code);
			const worksheet: CourseFile = {
				path: 'worksheet.Rmd',
				kind: 'text',
				size: code.length,
				download: `/_files/blobs/${blob}`
			};
			const render = () => buildRmdPreviews(site, 'test-course', [worksheet], output, () => {});
			const firstRuntime = rRuntimeVersion(process.env, true);
			expect(firstRuntime).toContain('fontconfig-unverified-v1:');
			await render();
			const cache = path.join(site, 'build/generated/cache/rmd');
			const firstKey = readdirSync(cache)[0];
			expect(existsSync(path.join(cache, firstKey, 'result.json'))).toBe(true);
			expect(
				JSON.parse(
					readFileSync(path.join(output, 'blobs', path.basename(worksheet.rmdPreview!)), 'utf8')
				).html
			).toContain('[1] 2');
			expect(rRuntimeVersion(process.env, true)).toBe(firstRuntime);
			await render();
			expect(readdirSync(cache)).toEqual([firstKey]);
			expect(readFileSync(renders, 'utf8').trim().split('\n')).toEqual(['render', 'render']);
		} finally {
			if (originalPath === undefined) delete process.env.PATH;
			else process.env.PATH = originalPath;
			if (originalExecutable === undefined) delete process.env.RSCRIPT;
			else process.env.RSCRIPT = originalExecutable;
			rmSync(site, { recursive: true, force: true });
		}
	},
	30_000
);
