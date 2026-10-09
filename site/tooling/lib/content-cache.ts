import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { FullSlug } from './slug';
import { writeChanged } from './output';

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

function ownedObject(value: unknown, edition: ContentEdition, kind?: 'bodies' | 'docs') {
	return (
		typeof value === 'string' &&
		contentObjectPath.test(value) &&
		value.startsWith(`content/${edition}/${kind ?? ''}`)
	);
}

export function readContentObject(cache: string, relative: string, edition: ContentEdition) {
	if (!ownedObject(relative, edition)) return;
	const bytes = readRegular(cache, relative);
	if (!bytes || contentHash(bytes) !== path.basename(relative, '.json')) return;
	return bytes;
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
