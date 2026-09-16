import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildRmdPreviews } from '../tooling/lib/rmd-previews';
import type { CourseFile, RmdPreview } from '../src/lib/files';

test('knits results, inline R, plots and chunk options; caches and invalidates data changes', async () => {
	const site = mkdtempSync(path.join(tmpdir(), 'wisconsin-rmd-test-'));
	const output = path.join(site, 'build/generated/assets/_files');
	mkdirSync(path.join(output, 'blobs'), { recursive: true });
	const files: CourseFile[] = [];
	function input(name: string, text: string) {
		const hash = createHash('sha256').update(text).digest('hex');
		writeFileSync(path.join(output, 'blobs', `${hash}.bin`), text);
		const file: CourseFile = {
			path: name,
			kind: 'text' as const,
			size: text.length,
			download: `/_files/blobs/${hash}.bin`
		};
		const i = files.findIndex((file) => file.path === name);
		if (i < 0) files.push(file);
		else files[i] = file;
		return file;
	}
	const worksheet = input(
		'notes/example.Rmd',
		`---
title: Rendered example
---

\`\`\`{r setup, include=FALSE}
knitr::opts_chunk$set(echo=TRUE, out.width="50%")
hidden_setup_value <- 123
\`\`\`

\`\`\`{r data, echo=FALSE}
x <- read.csv("values.csv")$value
sum(x)
plot(x)
\`\`\`

Inline result: \`r sum(x)\`. Math: $x^2$.

\`\`\`{r skipped, eval=FALSE}
stop("must not run")
\`\`\`

\`\`\`{r}
file.exists("private.csv")
\`\`\`
`
	);
	input('notes/values.csv', 'value\n2\n3\n');
	files.push({ path: 'notes/private.csv', kind: 'text', size: 10, locked: true });
	try {
		const retained = new Set<string>();
		const render = () =>
			buildRmdPreviews(site, 'test-course', files, output, (file) => retained.add(file));
		const preview = () =>
			JSON.parse(
				readFileSync(path.join(output, 'blobs', path.basename(worksheet.rmdPreview!)), 'utf8')
			) as RmdPreview;
		await render();
		expect(preview().title).toBe('Rendered example');
		expect(preview().html).toContain('Inline result: 5');
		expect(preview().html).toContain('[1] 5');
		expect(preview().html).toContain('FALSE');
		expect(preview().html).toContain('katex');
		expect(preview().html).not.toContain('hidden_setup_value');
		expect(preview().html).not.toContain('read.csv');
		expect(preview().html).toContain('must not run');
		expect(preview().html).toMatch(/<img src="\/_files\/blobs\/[a-f0-9]+\.png"/);
		const plot = [...retained].find((file) => file.endsWith('.png'))!;
		expect(readFileSync(plot).subarray(1, 4).toString()).toBe('PNG');
		const first = worksheet.rmdPreview;
		const stamp = statSync(plot).mtimeMs;
		const executable = process.env.RSCRIPT;
		try {
			process.env.RSCRIPT = '/no-r-execution-on-cache-hit';
			await render();
		} finally {
			if (executable === undefined) delete process.env.RSCRIPT;
			else process.env.RSCRIPT = executable;
		}
		expect(worksheet.rmdPreview).toBe(first);
		expect(statSync(plot).mtimeMs).toBe(stamp);
		input('notes/values.csv', 'value\n7\n3\n');
		await render();
		expect(worksheet.rmdPreview).not.toBe(first);
		expect(preview().html).toContain('Inline result: 10');
		input('notes/values.csv', 'wrong_column\n2\n3\n');
		await expect(render()).rejects.toThrow('Could not render test-course/notes/example.Rmd');
	} finally {
		rmSync(site, { recursive: true, force: true });
	}
}, 30_000);

test('locked worksheets are not executed or exported', async () => {
	const files: CourseFile[] = [{ path: 'private.Rmd', kind: 'text', size: 20, locked: true }];
	await buildRmdPreviews('/unused', 'test', files, '/unused', () => {
		throw new Error('Must not emit');
	});
	expect(files[0].rmdPreview).toBeUndefined();
});
