import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, type BigIntStats } from 'node:fs';
import path from 'node:path';
import type { FullSlug } from './slug';
import { captureCopyValidation, copyChanged, restoreCopyValidation, writeChanged } from './output';

export type ContentEdition = 'public' | 'full';
export interface ContentSummary {
	slug: FullSlug;
	rel: string;
	frontmatter: Record<string, unknown> & { title: string };
	heading?: string;
	title: string;
	description: string;
	tags: string[];
	toc: { depth: number; text: string; slug: string }[];
	draft: boolean;
	hasMermaid: boolean;
	wordCount: number;
}
export interface ContentCachePage {
	parseKey: string;
	summary: ContentSummary;
	outgoing: string[];
	transcludes: { target: string; selector?: string }[];
	parseWarnings: string[];
	unknownLanguages?: Record<string, number>;
	linkWarnings: string[];
	transclusionWarnings: string[];
	body?: string;
	document?: string;
	documentKey?: string;
}
export interface ContentCacheIndex {
	schema: 1;
	renderer: string;
	context: string;
	pages: Record<string, ContentCachePage>;
}
export interface ContentBody {
	html: string;
	markdown: string;
}

export function contentHash(bytes: string | Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

const digest = /^[a-f0-9]{64}$/;
export const contentObjectPath = /^content\/(?:public|full)\/(?:bodies|docs)\/[a-f0-9]{64}\.json$/;
const strings = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((item) => typeof item === 'string');

/** Refuse symlinks at every level; restored manifests contain portable paths only. */
function readRegular(cache: string, relative: string): Buffer | undefined {
	try {
		const root = realpathSync(cache);
		if (root !== path.resolve(cache)) return;
		const file = path.join(root, relative);
		if (realpathSync(file) !== file || !lstatSync(file).isFile()) return;
		return readFileSync(file);
	} catch {
		return;
	}
}

function writeOwned(cache: string, relative: string, bytes: string | Uint8Array) {
	const root = path.resolve(cache);
	mkdirSync(root, { recursive: true });
	if (realpathSync(root) !== root)
		throw new Error('Content cache must have owned directory ancestors');
	let directory = root;
	for (const segment of relative.split('/').slice(0, -1)) {
		directory = path.join(directory, segment);
		const info = lstatSync(directory, { throwIfNoEntry: false });
		if (info && (!info.isDirectory() || realpathSync(directory) !== directory))
			throw new Error('Content cache must have owned directory ancestors');
		if (!info) mkdirSync(directory);
	}
	const target = path.join(root, relative);
	const info = lstatSync(target, { throwIfNoEntry: false });
	if (info && (!info.isFile() || realpathSync(target) !== target))
		throw new Error('Content cache entries must be owned regular files');
	writeChanged(target, bytes);
}

function ownedObject(
	value: unknown,
	edition: ContentEdition,
	kind?: 'bodies' | 'docs'
): value is string {
	return (
		typeof value === 'string' &&
		contentObjectPath.test(value) &&
		value.startsWith(`content/${edition}/${kind ?? ''}`)
	);
}

export function readContentObject(cache: string, relative: string, edition: ContentEdition) {
	if (!ownedObject(relative, edition)) return;
	return readObjectFile(path.resolve(cache, relative));
}

function readObjectFile(file: string): Buffer | undefined {
	const bytes = readRegular(path.dirname(file), path.basename(file));
	if (!bytes || contentHash(bytes) !== path.basename(file, '.json')) return;
	return bytes;
}

/** Emit by dependency identity, validating cached bytes whenever either file changes. */
export function emitContentDocument(
	cache: string,
	edition: ContentEdition,
	record: ContentCachePage,
	key: string,
	destination: string,
	create: () => unknown,
	development = false
): number {
	if (
		record.documentKey === key &&
		ownedObject(record.document, edition, 'docs') &&
		ownedFileStamp(path.resolve(cache, record.document))
	) {
		const copied = copyChanged(
			path.resolve(cache, record.document),
			destination,
			development,
			readObjectFile
		);
		if (copied !== undefined) return copied;
	}
	const bytes = Buffer.from(JSON.stringify(create()));
	record.document = writeContentObject(cache, edition, 'docs', bytes);
	record.documentKey = key;
	if (development) {
		const copied = copyChanged(
			path.resolve(cache, record.document),
			destination,
			true,
			readObjectFile
		);
		if (copied === undefined) throw new Error('Generated content document failed validation');
		return copied;
	} else writeChanged(destination, bytes);
	return bytes.byteLength;
}

function pageDocumentPath(relative: unknown): relative is string {
	return (
		typeof relative === 'string' &&
		relative.startsWith('build/generated/pages/') &&
		relative.endsWith('.json') &&
		!relative.includes('\\') &&
		!relative.split('/').some((segment) => !segment || segment === '.' || segment === '..')
	);
}

/** Persist only validated document copies inside this edition and site. */
export function captureContentDocumentValidation(
	cache: string,
	site: string,
	edition: ContentEdition
) {
	const files: [string, string, string, string][] = [];
	for (const copy of captureCopyValidation(readObjectFile)) {
		const source = path.relative(cache, copy.source).split(path.sep).join('/');
		const destination = path.relative(site, copy.destination).split(path.sep).join('/');
		if (ownedObject(source, edition, 'docs') && pageDocumentPath(destination))
			files.push([source, destination, copy.input, copy.output]);
	}
	return { version: 1, files };
}

/** The caller has already matched saved engine, source and output fingerprints. */
export function restoreContentDocumentValidation(
	cache: string,
	site: string,
	edition: ContentEdition,
	saved: unknown,
	outputs: ReadonlyMap<string, Readonly<BigIntStats>>
) {
	if (!saved || typeof saved !== 'object' || !('version' in saved) || saved.version !== 1) return;
	if (!('files' in saved) || !Array.isArray(saved.files)) return;
	for (const entry of saved.files) {
		if (
			!Array.isArray(entry) ||
			entry.length !== 4 ||
			!ownedObject(entry[0], edition, 'docs') ||
			!pageDocumentPath(entry[1]) ||
			typeof entry[2] !== 'string' ||
			typeof entry[3] !== 'string'
		)
			continue;
		const [source, destination, input, output] = entry;
		const file = path.resolve(site, destination);
		const observed = outputs.get(file);
		if (observed)
			restoreCopyValidation(
				{ source: path.resolve(cache, source), destination: file, input, output },
				observed,
				readObjectFile
			);
	}
}

export function readContentBody(cache: string, relative: string, edition: ContentEdition) {
	if (!ownedObject(relative, edition, 'bodies')) return;
	try {
		const bytes = readContentObject(cache, relative, edition);
		if (!bytes) return;
		const body: unknown = JSON.parse(bytes.toString());
		if (
			body &&
			typeof body === 'object' &&
			'html' in body &&
			typeof body.html === 'string' &&
			'markdown' in body &&
			typeof body.markdown === 'string'
		)
			return body as ContentBody;
	} catch {
		return;
	}
}

// Keep only validation metadata for the current development selection, never HTML.
const validatedBodies = new Map<string, string>();

/** Save only prior validation observations, never freshly stat unvalidated bytes. */
export function captureContentBodyValidation(cache: string, edition: ContentEdition) {
	const files: [string, string][] = [];
	for (const [file, stamp] of validatedBodies) {
		const relative = path.relative(cache, file).split(path.sep).join('/');
		if (ownedObject(relative, edition, 'bodies')) files.push([relative, stamp]);
	}
	return { version: 1, files };
}

/** Called only after saved engine, source and output identities have been validated. */
export function restoreContentBodyValidation(
	cache: string,
	edition: ContentEdition,
	saved: unknown
) {
	if (!saved || typeof saved !== 'object' || !('version' in saved) || saved.version !== 1) return;
	if (!('files' in saved) || !Array.isArray(saved.files)) return;
	for (const entry of saved.files) {
		if (
			!Array.isArray(entry) ||
			entry.length !== 2 ||
			!ownedObject(entry[0], edition, 'bodies') ||
			typeof entry[1] !== 'string'
		)
			continue;
		// readContentBodies still compares this observation with a fresh owned
		// file identity before skipping byte validation. Lazy reads recheck hashes.
		validatedBodies.set(path.resolve(cache, entry[0]), entry[1]);
	}
}

function ownedFileStamp(file: string) {
	try {
		const info = lstatSync(file, { bigint: true, throwIfNoEntry: false });
		if (!info?.isFile() || realpathSync(file) !== file) return;
		return [info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs].join(':');
	} catch {
		return;
	}
}

function bodyReader(cache: string, relative: string, edition: ContentEdition) {
	return () => {
		const body = readContentBody(cache, relative, edition);
		if (!body) throw new Error(`Content body changed after validation: ${relative}`);
		return body;
	};
}

/** Validate body references eagerly; read their bytes only when a document needs rebuilding. */
export function readContentBodies(
	cache: string,
	edition: ContentEdition,
	relatives: Iterable<string>,
	development = false
) {
	const readers = new Map<string, () => ContentBody>();
	const selected = new Set<string>();
	for (const relative of new Set(relatives)) {
		if (!ownedObject(relative, edition, 'bodies')) continue;
		const file = path.resolve(cache, relative);
		selected.add(file);
		const stamp = development ? ownedFileStamp(file) : undefined;
		if (stamp && validatedBodies.get(file) === stamp) {
			readers.set(relative, bodyReader(cache, relative, edition));
			continue;
		}
		if (development) validatedBodies.delete(file);
		const body = readContentBody(cache, relative, edition);
		if (!body) continue;
		readers.set(relative, development ? bodyReader(cache, relative, edition) : () => body);
		if (stamp) validatedBodies.set(file, stamp);
	}
	if (development)
		for (const file of validatedBodies.keys())
			if (!selected.has(file)) validatedBodies.delete(file);
	return readers;
}

function validPage(value: unknown, edition: ContentEdition): value is ContentCachePage {
	if (!value || typeof value !== 'object') return false;
	const page = value as ContentCachePage;
	const summary = page.summary;
	return (
		digest.test(page.parseKey) &&
		!!summary &&
		typeof summary === 'object' &&
		typeof summary.rel === 'string' &&
		typeof summary.slug === 'string' &&
		typeof summary.title === 'string' &&
		typeof summary.description === 'string' &&
		!!summary.frontmatter &&
		typeof summary.frontmatter === 'object' &&
		!Array.isArray(summary.frontmatter) &&
		typeof summary.draft === 'boolean' &&
		typeof summary.hasMermaid === 'boolean' &&
		Number.isFinite(summary.wordCount) &&
		strings(summary.tags) &&
		Array.isArray(summary.toc) &&
		summary.toc.every(
			(entry) =>
				entry &&
				Number.isFinite(entry.depth) &&
				typeof entry.text === 'string' &&
				typeof entry.slug === 'string'
		) &&
		strings(page.outgoing) &&
		strings(page.parseWarnings) &&
		strings(page.linkWarnings) &&
		strings(page.transclusionWarnings) &&
		(page.unknownLanguages === undefined ||
			(!!page.unknownLanguages &&
				typeof page.unknownLanguages === 'object' &&
				!Array.isArray(page.unknownLanguages) &&
				Object.values(page.unknownLanguages).every(
					(count) => Number.isInteger(count) && count > 0
				))) &&
		Array.isArray(page.transcludes) &&
		page.transcludes.every(
			(entry) =>
				entry &&
				typeof entry.target === 'string' &&
				(entry.selector === undefined || typeof entry.selector === 'string')
		) &&
		(page.body === undefined || ownedObject(page.body, edition, 'bodies')) &&
		(page.document === undefined || ownedObject(page.document, edition, 'docs')) &&
		(page.documentKey === undefined || digest.test(page.documentKey))
	);
}

export function readContentIndex(cache: string, edition: ContentEdition, renderer: string) {
	try {
		const bytes = readRegular(cache, `content-current-${edition}.json`);
		if (!bytes) return;
		const { checksum, ...index } = JSON.parse(bytes.toString());
		if (
			index.schema !== 1 ||
			index.renderer !== renderer ||
			!digest.test(index.context) ||
			checksum !== contentHash(JSON.stringify(index)) ||
			!index.pages ||
			typeof index.pages !== 'object' ||
			Array.isArray(index.pages) ||
			!Object.entries(index.pages).every(
				([relative, page]) => validPage(page, edition) && page.summary.rel === relative
			)
		)
			return;
		return index as ContentCacheIndex;
	} catch {
		return;
	}
}

export function writeContentObject(
	cache: string,
	edition: ContentEdition,
	kind: 'bodies' | 'docs',
	bytes: string | Uint8Array
) {
	const relative = `content/${edition}/${kind}/${contentHash(bytes)}.json`;
	writeOwned(cache, relative, bytes);
	return relative;
}

/** Commit the current selection only after the compiler completed all output checks. */
export function writeContentIndex(
	cache: string,
	edition: ContentEdition,
	index: ContentCacheIndex
) {
	const payload = JSON.stringify(index);
	writeOwned(
		cache,
		`content-current-${edition}.json`,
		JSON.stringify({ ...index, checksum: contentHash(payload) })
	);
	const files = new Set<string>([`content-current-${edition}.json`]);
	for (const page of Object.values(index.pages)) {
		if (page.body) files.add(page.body);
		if (page.document) files.add(page.document);
	}
	writeOwned(cache, `content-files-current-${edition}.json`, JSON.stringify([...files].sort()));
}

/** Earlier targets may already be expanded, so the safe reverse closure is not depth limited. */
export function transclusionClosure(pages: Iterable<ContentCachePage>, changed: Set<string>) {
	const records = [...pages];
	const affected = new Set(changed);
	let added: boolean;
	do {
		added = false;
		for (const page of records) {
			if (affected.has(page.summary.slug)) continue;
			if (page.transcludes.some(({ target }) => affected.has(target))) {
				affected.add(page.summary.slug);
				added = true;
			}
		}
	} while (added);
	return affected;
}
