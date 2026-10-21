import { stageFingerprint } from '../fingerprint';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CourseFile, RmdPreview } from '../../src/lib/files';
import { writeChanged } from './output';
import {
	lockedRRuntime,
	rRuntimeVersion,
	freshRRuntimeVersion,
	verifyRRenderProfile
} from './r-runtime';
import {
	readRmdPreviewResult,
	rmdCourseInputs,
	rmdPreviewKey,
	rmdPreviewRecord,
	type RmdPreviewResult
} from './rmd-preview-cache';

const runR = promisify(execFile);
const runner = path.join(import.meta.dirname, 'knit-rmd.R');
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const limit = 25 * 1024 * 1024;

/** Knit only available course files, in a temporary copy, never in the source checkout. */
export async function buildRmdPreviews(
	site: string,
	course: string,
	files: CourseFile[],
	output: string,
	retain: (file: string) => void,
	options: {
		worksheet?: string;
		publish?: boolean;
		refreshRuntime?: boolean;
		signal?: AbortSignal;
	} = {}
) {
	const results = new Map<string, { key: string; result: RmdPreviewResult }>();
	const worksheets = files.filter(
		(file) =>
			!file.locked &&
			file.download &&
			/\.rmd$/i.test(file.path) &&
			(!options.worksheet || file.path === options.worksheet)
	);
	if (!worksheets.length) return results;
	const cacheOnly = process.env.R_CACHE_ONLY === '1';
	let runtime: string;
	try {
		runtime = cacheOnly
			? lockedRRuntime(site)
			: options.refreshRuntime
				? await freshRRuntimeVersion(process.env, options.signal)
				: rRuntimeVersion();
	} catch (error) {
		if (cacheOnly || process.env.R_REQUIRE_PROFILE === '1')
			throw new Error(
				'Verified R previews are unavailable; install the locked R renderer before building',
				{ cause: error }
			);
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`rmd: ${message} Using Source and Interactive views.`);
		for (const worksheet of worksheets) delete worksheet.rmdPreview;
		return results;
	}
	verifyRRenderProfile(site, runtime);
	const available = files.filter((file) => !file.locked && file.download);
	const inputs = rmdCourseInputs(files);
	const policy = await stageFingerprint('rmd');
	for (const worksheet of worksheets) {
		const context = { runtime, policy, course, inputs, worksheet: worksheet.path };
		const key = rmdPreviewKey(context);
		const cache = path.join(site, 'build/generated/cache/rmd', key);
		const record = path.join(cache, 'result.json');
		let result = readRmdPreviewResult(site, context);
		if (!result && cacheOnly)
			throw new Error(
				`Verified R preview is missing or stale for ${course}/${worksheet.path}; install the locked R renderer before building`
			);
		if (!result) {
			const scratch = mkdtempSync(path.join(tmpdir(), 'wisconsin-rmd-'));
			try {
				const working = path.join(scratch, 'course');
				for (const file of available) {
					const target = path.join(working, file.path);
					mkdirSync(path.dirname(target), { recursive: true });
					copyFileSync(path.join(output, 'blobs', path.basename(file.download!)), target);
				}
				const figures = path.join(scratch, 'figures');
				mkdirSync(figures);
				const knitted = path.join(scratch, 'knitted.md');
				await runR(
					process.env.RSCRIPT ?? 'Rscript',
					['--vanilla', runner, path.join(working, worksheet.path), knitted, figures],
					{ cwd: working, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, signal: options.signal }
				);
				let markdown = readFileSync(knitted, 'utf8');
				const blobs: string[] = [];
				const save = (bytes: Uint8Array, extension: string) => {
					if (bytes.length > limit)
						throw new Error('Rendered R Markdown asset exceeds the 25 MiB hosting limit');
					const blob = `${digest(bytes)}.${extension}`;
					writeChanged(path.join(cache, blob), bytes);
					blobs.push(blob);
					return blob;
				};
				for (const figure of readdirSync(figures, { recursive: true, withFileTypes: true })) {
					if (!figure.isFile()) continue;
					const source = path.join(figure.parentPath, figure.name);
					const extension = path.extname(source).slice(1);
					if (!['png', 'jpg', 'jpeg', 'svg', 'pdf'].includes(extension))
						throw new Error(`Unsupported R plot format: ${extension}`);
					const blob = save(readFileSync(source), extension);
					markdown = markdown.split(source).join(`/_files/blobs/${blob}`);
				}
				const { parseRmd } = await import('../../src/lib/rmd');
				const parsed = await parseRmd(markdown, course, worksheet.path, files);
				if (parsed.blocks.some((block) => block.kind === 'r'))
					throw new Error('Knitting left an unevaluated R chunk');
				const preview: RmdPreview = {
					title: parsed.title,
					html: parsed.blocks
						.map((block) => (block.kind === 'markdown' ? block.html : ''))
						.join('\n')
				};
				result = {
					preview: save(Buffer.from(JSON.stringify(preview)), 'json'),
					blobs: [...new Set(blobs)]
				};
				writeChanged(record, JSON.stringify(rmdPreviewRecord(context, result)));
				console.log(`rmd: rendered ${course}/${worksheet.path}`);
			} catch (error) {
				throw new Error(`Could not render ${course}/${worksheet.path}: ${String(error)}`, {
					cause: error
				});
			} finally {
				rmSync(scratch, { recursive: true, force: true });
			}
		}
		results.set(worksheet.path, { key, result });
		if (options.publish === false) continue;
		for (const blob of result.blobs) {
			const destination = path.join(output, 'blobs', blob);
			writeChanged(destination, readFileSync(path.join(cache, blob)));
			retain(destination);
		}
		worksheet.rmdPreview = `/_files/blobs/${result.preview}`;
	}
	return results;
}
