import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CourseFile, RmdPreview } from '../../src/lib/files';
import { courseFilesDirectory } from './edition-paths.js';
import { browsablePath } from './file-policy';
import {
	devRmdVersion,
	rmdCourseInputs,
	rmdPreviewKey,
	type RmdPreviewInputs,
	type RmdPreviewResult
} from './rmd-preview-cache';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const blobPattern = /^[a-f0-9]{64}\.(?:json|png|jpg|jpeg|svg|pdf)$/;
const previewPath = '/__content/rmd';
const assetPath = '/__content/rmd-assets';

function readOwned(file: string) {
	const info = lstatSync(file);
	if (realpathSync(file) !== file || !info.isFile()) throw new Error('Not found');
	if (info.size > 25 * 1024 * 1024) throw new Error('Oversized preview');
	const bytes = readFileSync(file);
	return bytes;
}

/** Authorize against the current edition's generated catalog, never caller-supplied source paths. */
export function readDevRmdRequest(site: string, url: URL) {
	const course = url.searchParams.get('course') ?? '';
	const file = url.searchParams.get('file') ?? '';
	if (
		!browsablePath(course) ||
		course.includes('/') ||
		!browsablePath(file) ||
		!/\.rmd$/i.test(file)
	)
		throw new Error('Not found');
	const output = courseFilesDirectory(site);
	const files = JSON.parse(
		readOwned(path.join(output, 'index', `${course}.json`)).toString()
	) as CourseFile[];
	if (!Array.isArray(files)) throw new Error('Not found');
	for (const entry of files) {
		if (
			!browsablePath(entry.path) ||
			(entry.download && !/^\/_files\/blobs\/[a-f0-9]{64}\.[a-z]+$/.test(entry.download))
		)
			throw new Error('Invalid catalog');
	}
	const entry = files.find((entry) => entry.path === file);
	if (!entry || entry.locked || !entry.download || !entry.rmdPreview?.startsWith(previewPath + '?'))
		throw new Error('Not found');
	const version = devRmdVersion(files);
	if (url.searchParams.get('v') !== version) throw new Error('Stale preview request');
	return { course, file, files, output, version };
}

type Selection = ReturnType<typeof readDevRmdRequest>;
type PreviewRecord = RmdPreviewInputs & RmdPreviewResult & { schemaVersion: number };

function selectedRecord(site: string, selection: Selection, key: string) {
	if (!hashPattern.test(key)) throw new Error('Not found');
	const cache = path.join(site, 'build/generated/cache/rmd', key);
	const record = JSON.parse(readOwned(path.join(cache, 'result.json')).toString()) as PreviewRecord;
	if (
		record.schemaVersion !== 2 ||
		record.course !== selection.course ||
		record.worksheet !== selection.file ||
		record.inputs !== rmdCourseInputs(selection.files) ||
		rmdPreviewKey(record) !== key ||
		!Array.isArray(record.blobs) ||
		record.blobs.length > 1024 ||
		!record.blobs.includes(record.preview) ||
		!record.blobs.every((blob) => typeof blob === 'string' && blobPattern.test(blob))
	)
		throw new Error('Not found');
	return { cache, record };
}

function readBlob(cache: string, record: PreviewRecord, blob: string) {
	if (!blobPattern.test(blob) || !record.blobs.includes(blob)) throw new Error('Not found');
	const bytes = readOwned(path.join(cache, blob));
	if (digest(bytes) !== blob.slice(0, 64)) throw new Error('Corrupt preview asset');
	return bytes;
}

interface PreviewJob {
	readonly worker: ChildProcess;
	result: Promise<string | undefined>;
	users: number;
	finished: boolean;
}

/** Render one requested worksheet outside Vite; keep generated previews in the consumer cache. */
export function developmentRmd(site: string, ready: () => Promise<void>) {
	const workers = new Set<ChildProcess>();
	const pending = new Map<string, PreviewJob>();
	let closed = false;
	function stop(worker: ChildProcess) {
		try {
			if (process.platform !== 'win32' && worker.pid) process.kill(-worker.pid, 'SIGTERM');
			else worker.kill();
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
		}
	}
	async function render(url: URL, signal: AbortSignal) {
		if (signal.aborted) throw new Error('Preview request cancelled');
		const request = url.pathname + url.search;
		let active = pending.get(request);
		if (!active) {
			if (closed) throw new Error('Preview service closed');
			const worker = spawn('bun', [path.join(site, 'tooling/dev-rmd-worker.ts'), request], {
				cwd: site,
				env: process.env,
				detached: process.platform !== 'win32',
				stdio: ['ignore', 'inherit', 'inherit', 'ipc']
			});
			workers.add(worker);
			const result = new Promise<string | undefined>((resolve, reject) => {
				const timer = setTimeout(() => {
					stop(worker);
					reject(new Error('Worksheet preview timed out'));
				}, 150_000);
				worker.once('message', (message: { key?: string; error?: string }) => {
					if (message.error) reject(new Error(message.error));
					else resolve(message.key);
				});
				worker.once('error', reject);
				worker.once('close', () => {
					clearTimeout(timer);
					workers.delete(worker);
					reject(new Error('Preview worker exited before returning a result'));
				});
			});
			const job = { worker, result, users: 0, finished: false };
			job.result = result.finally(() => {
				job.finished = true;
				// A cancelled render may already have a replacement for the same URL.
				if (pending.get(request) === job) pending.delete(request);
			});
			pending.set(request, job);
			active = job;
		}
		active.users++;
		let cancelled!: () => void;
		const cancellation = new Promise<never>((_resolve, reject) => {
			cancelled = () => reject(new Error('Preview request cancelled'));
			signal.addEventListener('abort', cancelled, { once: true });
		});
		try {
			return await Promise.race([active.result, cancellation]);
		} finally {
			signal.removeEventListener('abort', cancelled);
			if (--active.users === 0 && !active.finished) {
				if (pending.get(request) === active) pending.delete(request);
				stop(active.worker);
			}
		}
	}
	return {
		async serve(request: IncomingMessage, response: ServerResponse) {
			const url = new URL(request.url ?? '/', 'http://localhost');
			if (url.pathname !== previewPath && url.pathname !== assetPath) return false;
			response.setHeader('Cache-Control', 'no-store');
			if (request.method !== 'GET' && request.method !== 'HEAD') {
				response.statusCode = 405;
				response.end();
				return true;
			}
			try {
				let selection = readDevRmdRequest(site, url);
				if (url.pathname === assetPath) {
					const { cache, record } = selectedRecord(
						site,
						selection,
						url.searchParams.get('key') ?? ''
					);
					const blob = url.searchParams.get('asset') ?? '';
					const bytes = readBlob(cache, record, blob);
					const types: { [extension: string]: string } = {
						png: 'image/png',
						jpg: 'image/jpeg',
						jpeg: 'image/jpeg',
						svg: 'image/svg+xml',
						pdf: 'application/pdf',
						json: 'application/json'
					};
					response.setHeader('Content-Type', types[path.extname(blob).slice(1)]);
					response.end(request.method === 'HEAD' ? undefined : bytes);
				} else {
					let key: string | undefined;
					const abort = new AbortController();
					const disconnected = () => {
						if (!response.writableEnded) abort.abort();
					};
					response.once('close', disconnected);
					if (response.destroyed) abort.abort();
					try {
						key = await render(url, abort.signal);
					} catch (error) {
						if (abort.signal.aborted) return true;
						console.error(error);
						response.statusCode = 503;
						response.end('Worksheet preview unavailable');
						return true;
					} finally {
						response.off('close', disconnected);
					}
					// A policy or source edit may finish while R is running. Wait and authorize again.
					await ready();
					selection = readDevRmdRequest(site, url);
					if (!key) {
						response.statusCode = 204;
						response.end();
						return true;
					}
					const { cache, record } = selectedRecord(site, selection, key);
					const preview = JSON.parse(
						readBlob(cache, record, record.preview).toString()
					) as RmdPreview;
					if (typeof preview.html !== 'string' || typeof preview.title !== 'string')
						throw new Error('Invalid preview');
					for (const blob of record.blobs) {
						const query = new URLSearchParams({
							course: selection.course,
							file: selection.file,
							v: selection.version,
							key,
							asset: blob
						});
						preview.html = preview.html
							.split(`/_files/blobs/${blob}`)
							.join(`${assetPath}?${query}`.replaceAll('&', '&amp;'));
					}
					response.setHeader('Content-Type', 'application/json');
					response.end(request.method === 'HEAD' ? undefined : JSON.stringify(preview));
				}
			} catch {
				response.statusCode = 404;
				response.end('Worksheet preview unavailable');
			}
			return true;
		},
		close() {
			closed = true;
			for (const worker of workers) stop(worker);
		}
	};
}
