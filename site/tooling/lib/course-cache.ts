import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { CourseFile } from '../../src/lib/files';
import { writeChanged } from './output';
import { browsablePath } from './file-policy';

const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sha = /^[a-f0-9]{64}$/;
const courseName = /^[\w-]+$/;
const historyName = /^[a-f0-9]{64}(?:\.json|-blame\.json|-[a-f0-9]{40,64}\.diff)$/;
const blobName = /^blobs\/[a-f0-9]{64}\.(?:bin|pdf|png|jpg|jpeg|gif|webp|avif)$/;
type Origin =
	| { kind: 'index' }
	| { kind: 'source'; path: string }
	| { kind: 'history'; cachePath: string };
export type CourseCacheOutput = { path: string; bytes: number; sha256: string; origin: Origin };
export type CourseCacheRecord = {
	version: 2;
	course: string;
	fingerprint: string;
	files: CourseFile[];
	outputs: CourseCacheOutput[];
	payloadSha256: string;
};
export type CourseCacheContext = { repo: string; course: string; output: string; cache: string };

function regularBytes(root: string, relative: string) {
	if (
		!relative ||
		/[\\\x00-\x1f\x7f]/.test(relative) ||
		relative.split('/').some((part) => !part || part === '.' || part === '..')
	)
		return;
	const file = path.join(root, relative);
	try {
		if (!lstatSync(file).isFile() || realpathSync(file) !== path.join(realpathSync(root), relative))
			return;
		return readFileSync(file);
	} catch (error) {
		if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
		throw error;
	}
}

/** Portable identity includes tracked source bytes, offline edits, deletions and publication rules. */
export function courseFingerprint(
	repo: string,
	course: string,
	tracked: string[],
	version: string,
	notes: string
) {
	if (!courseName.test(course)) throw new Error('Unsafe course name');
	const hash = createHash('sha256').update(
		JSON.stringify(['course-files-v2', course, version, notes])
	);
	try {
		hash.update(
			execFileSync('git', ['-C', path.join(repo, 'content', course), 'rev-parse', 'HEAD'], {
				stdio: ['ignore', 'pipe', 'ignore']
			})
		);
	} catch {
		hash.update('unborn');
	}
	const prefix = `content/${course}/`;
	const inputs = [
		...new Set([
			...tracked.filter(
				(file) => file.startsWith(prefix) && browsablePath(file.slice(prefix.length))
			),
			`${prefix}publish.yaml`
		])
	].sort();
	for (const file of inputs) {
		const bytes = regularBytes(repo, file);
		hash.update(JSON.stringify([file, bytes ? [bytes.length, digest(bytes)] : null]));
	}
	return hash.digest('hex');
}

function payload(saved: Omit<CourseCacheRecord, 'payloadSha256'>) {
	return JSON.stringify([
		saved.version,
		saved.course,
		saved.fingerprint,
		saved.files,
		saved.outputs
	]);
}

/** Validate portable metadata before output restoration or transport selection. */
export function parseCourseCache(value: unknown, course: string): CourseCacheRecord | undefined {
	const saved = value as CourseCacheRecord;
	if (
		!saved ||
		saved.version !== 2 ||
		saved.course !== course ||
		!courseName.test(course) ||
		typeof saved.fingerprint !== 'string' ||
		!sha.test(saved.fingerprint) ||
		!Array.isArray(saved.files) ||
		!Array.isArray(saved.outputs) ||
		typeof saved.payloadSha256 !== 'string' ||
		!sha.test(saved.payloadSha256) ||
		digest(payload(saved)) !== saved.payloadSha256
	)
		return;
	if (
		!saved.files.every(
			(file) =>
				file &&
				typeof file.path === 'string' &&
				browsablePath(file.path) &&
				Number.isSafeInteger(file.size) &&
				file.size >= 0 &&
				['text', 'image', 'pdf', 'binary'].includes(file.kind) &&
				[file.download, file.history, file.rmdPreview, file.note].every(
					(value) => value === undefined || typeof value === 'string'
				)
		)
	)
		return;
	const paths = new Set<string>();
	for (const output of saved.outputs) {
		if (
			!output ||
			typeof output.path !== 'string' ||
			!browsablePath(output.path) ||
			paths.has(output.path) ||
			!Number.isSafeInteger(output.bytes) ||
			output.bytes < 0 ||
			typeof output.sha256 !== 'string' ||
			!sha.test(output.sha256) ||
			!output.origin
		)
			return;
		paths.add(output.path);
		if (output.origin.kind === 'index') {
			if (output.path !== `index/${course}.json`) return;
		} else if (output.origin.kind === 'history') {
			const name = output.path.slice('history/'.length);
			if (
				!output.path.startsWith('history/') ||
				!historyName.test(name) ||
				output.origin.cachePath !== `file-history/${course}/${name}`
			)
				return;
		} else if (output.origin.kind === 'source') {
			const source = output.origin.path;
			if (
				!blobName.test(output.path) ||
				output.path.slice(6, 70) !== output.sha256 ||
				typeof source !== 'string' ||
				!browsablePath(source) ||
				!saved.files.some(
					(file) =>
						!file.locked &&
						file.path === source &&
						file.size === output.bytes &&
						file.download === `/_files/${output.path}`
				)
			)
				return;
		} else return;
	}
	if (saved.files.length && !paths.has(`index/${course}.json`)) return;
	for (const file of saved.files) {
		if (
			file.download &&
			(file.locked ||
				!file.download.startsWith('/_files/blobs/') ||
				!paths.has(file.download.slice('/_files/'.length)))
		)
			return;
		if (
			file.history &&
			(file.locked ||
				!file.history.startsWith('/_files/history/') ||
				!paths.has(file.history.slice('/_files/'.length)))
		)
			return;
		if (file.rmdPreview) return; // R courses remain owned by the renderer preflight.
	}
	return saved;
}

function safeParents(root: string, relative: string) {
	for (let parent = path.dirname(relative); parent !== '.'; parent = path.dirname(parent)) {
		const target = path.join(root, parent);
		const stat = lstatSync(target, { throwIfNoEntry: false });
		if (
			stat &&
			(!stat.isDirectory() || realpathSync(target) !== path.join(realpathSync(root), parent))
		)
			return false;
	}
	return true;
}

export function readCourseCache(file: string, fingerprint: string, context: CourseCacheContext) {
	try {
		if (!lstatSync(file).isFile() || realpathSync(file) !== path.resolve(file)) return;
		const saved = parseCourseCache(JSON.parse(readFileSync(file, 'utf8')), context.course);
		if (!saved || saved.fingerprint !== fingerprint) return;
		const pending: CourseCacheOutput[] = [];
		const recoveryBytes = (output: CourseCacheOutput) => {
			if (output.origin.kind === 'index') return Buffer.from(JSON.stringify(saved.files));
			if (output.origin.kind === 'source')
				return regularBytes(path.join(context.repo, 'content', context.course), output.origin.path);
			return regularBytes(context.cache, output.origin.cachePath);
		};
		for (const output of saved.outputs) {
			if (!safeParents(context.output, output.path)) return;
			const existing = regularBytes(context.output, output.path);
			if (existing && existing.length === output.bytes && digest(existing) === output.sha256)
				continue;
			const bytes = recoveryBytes(output);
			if (!bytes || bytes.length !== output.bytes || digest(bytes) !== output.sha256) return;
			pending.push(output);
		}
		// Check the complete closure before writing; unavailable products rebuild normally.
		for (const output of pending) {
			// Recheck bytes at the write boundary without retaining whole courses in memory.
			const bytes = recoveryBytes(output);
			if (
				!bytes ||
				bytes.length !== output.bytes ||
				digest(bytes) !== output.sha256 ||
				!safeParents(context.output, output.path)
			)
				return;
			const target = path.join(context.output, output.path);
			mkdirSync(path.dirname(target), { recursive: true });
			const stat = lstatSync(target, { throwIfNoEntry: false });
			if (stat && !stat.isFile()) return;
			writeChanged(target, bytes);
		}
		return {
			files: saved.files,
			outputs: new Set(saved.outputs.map((output) => path.join(context.output, output.path)))
		};
	} catch {
		return;
	}
}

export function saveCourseCache(
	file: string,
	fingerprint: string,
	files: CourseFile[],
	outputs: Set<string>,
	context: CourseCacheContext
) {
	const records: CourseCacheOutput[] = [...outputs].sort().map((target) => {
		const relative = path.relative(context.output, target).split(path.sep).join('/');
		const bytes = regularBytes(context.output, relative);
		if (!bytes) throw new Error('Invalid course cache output');
		let origin: Origin;
		if (relative === `index/${context.course}.json`) origin = { kind: 'index' };
		else if (relative.startsWith('history/'))
			origin = {
				kind: 'history',
				cachePath: `file-history/${context.course}/${path.basename(relative)}`
			};
		else {
			const source = files.find(
				(entry) => !entry.locked && entry.download === `/_files/${relative}`
			);
			if (!source) throw new Error('Course output has no tracked source');
			origin = { kind: 'source', path: source.path };
		}
		return { path: relative, bytes: bytes.length, sha256: digest(bytes), origin };
	});
	const saved = {
		version: 2 as const,
		course: context.course,
		fingerprint,
		files,
		outputs: records
	};
	const record = { ...saved, payloadSha256: digest(payload(saved)) };
	if (!parseCourseCache(record, context.course)) throw new Error('Invalid portable course cache');
	writeChanged(file, JSON.stringify(record));
}
