import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { developmentRmd } from '../../tooling/lib/dev-rmd';
import { buildCourseFiles } from '../../tooling/lib/course-files';
import { setDevRmdPreviews } from '../../tooling/lib/rmd-preview-cache';
import { buildRmdPreviews } from '../../tooling/lib/rmd-previews';
import type { CourseFile } from '../../src/lib/files';

const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const source = path.resolve(import.meta.dirname, '../..');

test.each([1, 2])('abandoned preview jobs stop after all %i subscribers disconnect and can restart', async (count) => {
	const site = mkdtempSync(path.join(tmpdir(), 'twiki-rmd-disconnect-'));
	const files: CourseFile[] = [{
		path: 'worksheet.Rmd', kind: 'text', size: 10,
		download: `/_files/blobs/${hash('source')}.bin`
	}];
	setDevRmdPreviews('course', files);
	const index = path.join(site, 'build/generated/assets/_files/index/course.json');
	mkdirSync(path.dirname(index), { recursive: true });
	writeFileSync(index, JSON.stringify(files));
	mkdirSync(path.join(site, 'tooling'));
	writeFileSync(path.join(site, 'tooling/dev-rmd-worker.ts'), `
import fs from 'node:fs';
process.on('SIGTERM', () => {
  fs.writeFileSync('stopped', String(process.pid));
  setTimeout(() => process.exit(0), 100);
});
fs.appendFileSync('started', String(process.pid)+'\\n');
setInterval(() => {}, 1000);
`);
	const previews = developmentRmd(site, async () => {});
	let requests = 0;
	const server = createServer((request, response) => {
		requests++;
		void previews.serve(request, response);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const url = `http://127.0.0.1:${(server.address() as { port: number }).port}${files[0].rmdPreview}`;
	const controllers: AbortController[] = [];
	const fetchPreview = () => {
		const controller = new AbortController();
		controllers.push(controller);
		return fetch(url, { signal: controller.signal }).catch((error) => error);
	};
	const waitFor = async (check: () => boolean) => {
		const deadline = Date.now() + 2000;
		while (!check() && Date.now() < deadline) await Bun.sleep(10);
		expect(check()).toBe(true);
	};
	const starts = () => existsSync(path.join(site, 'started'))
		? readFileSync(path.join(site, 'started'), 'utf8').trim().split('\n') : [];
	const stopped = () => existsSync(path.join(site, 'stopped'))
		? readFileSync(path.join(site, 'stopped'), 'utf8') : undefined;
	try {
		const pending = Array.from({ length: count }, fetchPreview);
		await waitFor(() => starts().length === 1 && requests === count);
		const original = starts()[0];
		if (count === 2) {
			controllers[0].abort();
			expect((await pending[0]).name).toBe('AbortError');
			await Bun.sleep(100);
			expect(stopped()).toBeUndefined();
		}
		controllers[count - 1].abort();
		expect((await pending[count - 1]).name).toBe('AbortError');
		await waitFor(() => stopped() === original);
		// Start a replacement before the cancelled worker has exited. Its finalizer
		// must not delete the replacement and allow another duplicate render.
		const replacement = [fetchPreview(), fetchPreview()];
		await waitFor(() => starts().length === 2);
		await Bun.sleep(200);
		replacement.push(fetchPreview());
		await waitFor(() => requests === count + 3);
		await Bun.sleep(50);
		expect(starts()).toHaveLength(2);
		for (const controller of controllers) controller.abort();
		for (const response of await Promise.all(replacement)) expect(response.name).toBe('AbortError');
		await waitFor(() => stopped() === starts()[1]);
	} finally {
		for (const controller of controllers) controller.abort();
		previews.close();
		await Bun.sleep(150);
		await new Promise<void>((resolve) => server.close(() => resolve()));
		rmSync(site, { recursive: true, force: true });
	}
});

test('development file preparation exposes lazy worksheets without probing R, including after Markdown edits', async () => {
	const root = mkdtempSync(path.join(tmpdir(), 'twiki-rmd-lazy-catalog-'));
	const site = path.join(root, 'site');
	const previous = process.env.RSCRIPT;
	try {
		mkdirSync(site);
		mkdirSync(path.join(root, 'content/course'), { recursive: true });
		writeFileSync(
			path.join(root, 'twiki.config.json'),
			JSON.stringify({
				version: 1,
				contentDir: 'content',
				discovery: 'filesystem',
				publication: 'public'
			})
		);
		writeFileSync(
			path.join(root, 'content/course/worksheet.Rmd'),
			'# Worksheet\n\n```{r}\n1 + 1\n```'
		);
		const note = path.join(root, 'content/course/note.md');
		writeFileSync(note, '# Original');
		process.env.RSCRIPT = path.join(root, 'Rscript');
		writeFileSync(process.env.RSCRIPT, `#!/bin/sh\necho probe >> '${root}/probes'\nexit 1\n`, {
			mode: 0o755
		});
		const index = path.join(site, 'build/generated/assets/_files/index/course.json');
		await buildCourseFiles(site, new Set(['course/note']), undefined, true);
		const original = JSON.parse(readFileSync(index, 'utf8')).find(
			(file: CourseFile) => file.path === 'worksheet.Rmd'
		).rmdPreview;
		expect(original).toStartWith('/__content/rmd?');
		writeFileSync(note, '# Edited');
		await buildCourseFiles(site, new Set(['course/note']), new Set([note]), true);
		const changed = JSON.parse(readFileSync(index, 'utf8')).find(
			(file: CourseFile) => file.path === 'worksheet.Rmd'
		).rmdPreview;
		expect(changed).not.toBe(original);
		expect(existsSync(path.join(root, 'probes'))).toBe(false);
	} finally {
		if (previous === undefined) delete process.env.RSCRIPT;
		else process.env.RSCRIPT = previous;
		rmSync(root, { recursive: true, force: true });
	}
});

test('lazy preview requests share one worker, serve validated plots, and reject stale, locked and revoked requests', async () => {
	const site = mkdtempSync(path.join(tmpdir(), 'twiki-rmd-service-'));
	const index = path.join(site, 'build/generated/assets/_files/index/course.json');
	const files: CourseFile[] = [
		{
			path: 'worksheet.Rmd',
			kind: 'text',
			size: 10,
			download: `/_files/blobs/${hash('source')}.bin`
		}
	];
	setDevRmdPreviews('course', files);
	const writeIndex = () => {
		mkdirSync(path.dirname(index), { recursive: true });
		writeFileSync(index, JSON.stringify(files));
	};
	writeIndex();
	mkdirSync(path.join(site, 'tooling'));
	writeFileSync(
		path.join(site, 'tooling/dev-rmd-worker.ts'),
		`
import {readDevRmdRequest} from ${JSON.stringify(path.join(source, 'tooling/lib/dev-rmd.ts'))};
import {rmdCourseInputs,rmdPreviewKey,rmdPreviewRecord} from ${JSON.stringify(path.join(source, 'tooling/lib/rmd-preview-cache.ts'))};
import {createHash} from 'node:crypto';import fs from 'node:fs';import path from 'node:path';
const site=process.cwd();const s=readDevRmdRequest(site,new URL(process.argv[2],'http://localhost'));
fs.appendFileSync(path.join(site,'renders'),s.file+'\\n');await Bun.sleep(60);
const context={runtime:'fixture\\nfontconfig-v1:'+ 'a'.repeat(64),policy:'b'.repeat(64),course:s.course,inputs:rmdCourseInputs(s.files),worksheet:s.file};
const key=rmdPreviewKey(context),cache=path.join(site,'build/generated/cache/rmd',key);fs.mkdirSync(cache,{recursive:true});
const save=(bytes,ext)=>{const name=createHash('sha256').update(bytes).digest('hex')+'.'+ext;fs.writeFileSync(path.join(cache,name),bytes);return name};
const plot=save('<svg xmlns="http://www.w3.org/2000/svg"/>','svg');const preview=save(JSON.stringify({title:'Rendered worksheet',html:'<p>Computed result</p><img src="/_files/blobs/'+plot+'">'}),'json');
fs.writeFileSync(path.join(cache,'result.json'),JSON.stringify(rmdPreviewRecord(context,{preview,blobs:[plot,preview]})));
process.send({key},()=>process.disconnect());
`
	);
	let revoke = false;
	const previews = developmentRmd(site, async () => {
		if (revoke) {
			files[0].locked = true;
			writeIndex();
		}
	});
	const server = createServer((request, response) => {
		void previews.serve(request, response).then((handled) => {
			if (!handled) {
				response.statusCode = 404;
				response.end();
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	try {
		const url = origin + files[0].rmdPreview;
		const responses = await Promise.all([fetch(url), fetch(url)]);
		expect(responses.map((response) => response.status)).toEqual([200, 200]);
		expect(readFileSync(path.join(site, 'renders'), 'utf8')).toBe('worksheet.Rmd\n');
		const preview = (await responses[0].json()) as { html: string };
		const asset = /src="([^"]+)"/.exec(preview.html)![1].replaceAll('&amp;', '&');
		const plot = await fetch(origin + asset);
		expect(plot.status).toBe(200);
		expect(await plot.text()).toContain('<svg');
		expect((await fetch(origin + asset, { method: 'HEAD' })).headers.get('cache-control')).toBe(
			'no-store'
		);
		expect((await fetch(url.replace('worksheet.Rmd', '..%2Foutside.Rmd'))).status).toBe(404);
		expect((await fetch(url.replace(/v=[^&]+/, 'v=stale'))).status).toBe(404);
		const assetUrl = new URL(asset, origin);
		assetUrl.searchParams.set('asset', 'a'.repeat(64) + '.svg');
		expect((await fetch(assetUrl)).status).toBe(404);
		const selectedAsset = new URL(asset, origin);
		const cachedPlot = path.join(
			site,
			'build/generated/cache/rmd',
			selectedAsset.searchParams.get('key')!,
			selectedAsset.searchParams.get('asset')!
		);
		const originalPlot = readFileSync(cachedPlot);
		writeFileSync(cachedPlot, 'corrupt');
		expect((await fetch(origin + asset)).status).toBe(404);
		writeFileSync(cachedPlot, originalPlot);
		const outside = path.join(site, 'outside.svg');
		writeFileSync(outside, originalPlot);
		rmSync(cachedPlot);
		symlinkSync(outside, cachedPlot);
		expect((await fetch(origin + asset)).status).toBe(404);
		rmSync(cachedPlot);
		writeFileSync(cachedPlot, originalPlot);
		const edition = process.env.VITE_PUBLIC_EDITION;
		try {
			process.env.VITE_PUBLIC_EDITION = 'true';
			const publishedIndex = path.join(site, 'build/generated/public-files/index/course.json');
			mkdirSync(path.dirname(publishedIndex), { recursive: true });
			writeFileSync(
				publishedIndex,
				JSON.stringify([{ ...files[0], locked: true, rmdPreview: undefined }])
			);
			expect((await fetch(url)).status).toBe(404);
			expect((await fetch(origin + asset)).status).toBe(404);
		} finally {
			if (edition === undefined) delete process.env.VITE_PUBLIC_EDITION;
			else process.env.VITE_PUBLIC_EDITION = edition;
		}
		revoke = true;
		expect((await fetch(url)).status).toBe(404);
		expect((await fetch(origin + asset)).status).toBe(404);
		expect((await fetch(url, { method: 'POST' })).status).toBe(405);
	} finally {
		previews.close();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		rmSync(site, { recursive: true, force: true });
	}
});

const rAvailable =
	spawnSync(
		process.env.RSCRIPT ?? 'Rscript',
		['--vanilla', '-e', 'quit(status=if(requireNamespace("knitr",quietly=TRUE)) 0 else 1)'],
		{ stdio: 'pipe', timeout: 30000 }
	).status === 0;

test.skipIf(!rAvailable)(
	'real R renders only the requested worksheet and keeps generated plots out of the static tree',
	async () => {
		const site = mkdtempSync(path.join(tmpdir(), 'twiki-rmd-selected-'));
		const output = path.join(site, 'build/generated/assets/_files');
		mkdirSync(path.join(output, 'blobs'), { recursive: true });
		const add = (name: string, code: string): CourseFile => {
			const blob = hash(code) + '.bin';
			writeFileSync(path.join(output, 'blobs', blob), code);
			return {
				path: name,
				kind: 'text',
				size: Buffer.byteLength(code),
				download: '/_files/blobs/' + blob
			};
		};
		const files = [
			add('selected.Rmd', '# Selected\n\n```{r}\n1 + 1\nplot(1:3)\n```\n'),
			add('unopened.Rmd', '# Unopened\n\n```{r}\nstop("Must not knit unopened worksheets")\n```\n')
		];
		try {
			const results = await buildRmdPreviews(
				site,
				'course',
				files,
				output,
				() => {
					throw new Error('Must not publish lazy preview assets');
				},
				{ worksheet: 'selected.Rmd', publish: false, refreshRuntime: true }
			);
			expect([...results.keys()]).toEqual(['selected.Rmd']);
			const selected = results.get('selected.Rmd')!;
			const preview = JSON.parse(
				readFileSync(
					path.join(site, 'build/generated/cache/rmd', selected.key, selected.result.preview),
					'utf8'
				)
			);
			expect(preview.html).toContain('[1] 2');
			expect(selected.result.blobs.some((blob) => blob.endsWith('.png'))).toBe(true);
			expect(files.every((file) => file.rmdPreview === undefined)).toBe(true);
			setDevRmdPreviews('course', files);
			mkdirSync(path.join(output, 'index'));
			writeFileSync(path.join(output, 'index/course.json'), JSON.stringify(files));
			symlinkSync(path.join(source, 'tooling'), path.join(site, 'tooling'), 'dir');
			const previews = developmentRmd(site, async () => {});
			const server = createServer((request, response) => {
				void previews.serve(request, response);
			});
			await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
			try {
				const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
				const response = await fetch(origin + files[0].rmdPreview);
				expect(response.status).toBe(200);
				const rendered = (await response.json()) as { html: string };
				expect(rendered.html).toContain('[1] 2');
				const asset = /src="([^"]*rmd-assets[^"]*)"/
					.exec(rendered.html)![1]
					.replaceAll('&amp;', '&');
				const plot = await fetch(origin + asset);
				expect(plot.status).toBe(200);
				expect(
					Buffer.from(await plot.arrayBuffer())
						.subarray(1, 4)
						.toString()
				).toBe('PNG');
			} finally {
				previews.close();
				await new Promise<void>((resolve) => server.close(() => resolve()));
			}
			const started = path.join(site, 'r-started');
			const cancel = add(
				'cancel.Rmd',
				'# Cancel\n\n```{r}\nwriteLines("started", ' +
					JSON.stringify(started) +
					')\nSys.sleep(30)\n```\n'
			);
			const abort = new AbortController();
			const cancelled = buildRmdPreviews(site, 'course', [cancel], output, () => {}, {
				worksheet: cancel.path,
				publish: false,
				signal: abort.signal
			}).then(
				() => undefined,
				(error: Error) => error
			);
			for (let i = 0; i < 400 && !existsSync(started); i++)
				await new Promise((resolve) => setTimeout(resolve, 25));
			const stopped = performance.now();
			abort.abort();
			expect(existsSync(started)).toBe(true);
			expect((await cancelled)?.message).toContain('Could not render');
			expect(performance.now() - stopped).toBeLessThan(5000);
		} finally {
			rmSync(site, { recursive: true, force: true });
		}
	},
	120000
);
