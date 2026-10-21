import { expect, test, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	contentHash,
	captureContentBodyValidation,
	restoreContentBodyValidation,
	captureContentDocumentValidation,
	restoreContentDocumentValidation,
	emitContentDocument,
	readContentBody,
	readContentBodies,
	readContentIndex,
	readContentObject,
	transclusionClosure,
	writeContentIndex,
	writeContentObject,
	type ContentCachePage
} from '../../tooling/lib/content-cache';
import type { FullSlug } from '../../tooling/lib/slug';

function page(slug: string, targets: string[] = []): ContentCachePage {
	return {
		parseKey: 'a'.repeat(64),
		summary: {
			slug: slug as FullSlug,
			rel: `${slug}.md`,
			frontmatter: { title: slug },
			title: slug,
			description: '',
			tags: [],
			toc: [],
			draft: false,
			hasMermaid: false,
			wordCount: 1
		},
		outgoing: [],
		transcludes: targets.map((target) => ({ target })),
		parseWarnings: [],
		linkWarnings: [],
		transclusionWarnings: []
	};
}

test('body references validate changed files, reject symlinks and release obsolete selections without retaining HTML', () => {
	const cache = mkdtempSync(path.join(tmpdir(), 'twiki-body-references-'));
	const body = { html: '<p>original</p>', markdown: 'original' };
	const relative = writeContentObject(cache, 'full', 'bodies', JSON.stringify(body));
	const file = path.join(cache, relative);
	const read = () => readContentBodies(cache, 'full', [relative], true);
	try {
		expect(read().get(relative)?.()).toEqual(body);
		const spy = spyOn(fs, 'readFileSync');
		try {
			const references = read();
			expect(spy.mock.calls).toHaveLength(0);
			expect(references.get(relative)?.()).toEqual(body);
			expect(spy.mock.calls).toHaveLength(1);
			spy.mockClear();
			readContentBodies(cache, 'full', [relative]);
			expect(spy.mock.calls).toHaveLength(1);
			spy.mockClear();
			readContentBodies(cache, 'full', [], true);
			read();
			expect(spy.mock.calls).toHaveLength(1);
		} finally {
			spy.mockRestore();
		}
		const reference = read().get(relative)!;
		const stamp = fs.statSync(file);
		writeFileSync(file, JSON.stringify({ html: '<p>modified</p>', markdown: 'modified' }));
		fs.utimesSync(file, stamp.atime, stamp.mtime);
		expect(() => reference()).toThrow('changed after validation');
		expect(read().has(relative)).toBe(false);
		writeContentObject(cache, 'full', 'bodies', JSON.stringify(body));
		expect(read().get(relative)?.()).toEqual(body);
		rmSync(file);
		expect(read().has(relative)).toBe(false);
		writeContentObject(cache, 'full', 'bodies', JSON.stringify(body));
		read();
		const directory = path.dirname(file);
		fs.renameSync(directory, directory + '-moved');
		symlinkSync(directory + '-moved', directory);
		expect(read().has(relative)).toBe(false);
		expect(readContentBodies(cache, 'public', [relative], true).size).toBe(0);
		const invalid = writeContentObject(cache, 'full', 'docs', JSON.stringify(body));
		expect(readContentBodies(cache, 'full', [invalid], true).size).toBe(0);
	} finally {
		readContentBodies(cache, 'full', [], true);
		rmSync(cache, { recursive: true, force: true });
	}
});

test('first development validation rereads bodies on demand and rejects later corruption', () => {
	const cache = mkdtempSync(path.join(tmpdir(), 'twiki-first-body-reader-'));
	try {
		const body = { html: '<p>original</p>', markdown: 'original' };
		const relative = writeContentObject(cache, 'full', 'bodies', JSON.stringify(body));
		const reader = readContentBodies(cache, 'full', [relative], true).get(relative)!;
		expect(reader()).toEqual(body);
		writeFileSync(path.join(cache, relative), JSON.stringify({ ...body, html: 'corrupt' }));
		expect(() => reader()).toThrow('changed after validation');
	} finally {
		readContentBodies(cache, 'full', [], true);
		rmSync(cache, { recursive: true, force: true });
	}
});

test('saved body validation skips unchanged bytes but cannot bless later edits or another edition', () => {
	const cache = mkdtempSync(path.join(tmpdir(), 'twiki-restored-body-'));
	const body = { html: '<p>private body payload</p>', markdown: 'private body payload' };
	try {
		const relative = writeContentObject(cache, 'full', 'bodies', JSON.stringify(body));
		const file = path.join(cache, relative);
		readContentBodies(cache, 'full', [relative], true);
		const saved = JSON.parse(JSON.stringify(captureContentBodyValidation(cache, 'full')));
		expect(JSON.stringify(saved)).not.toContain('private body payload');
		readContentBodies(cache, 'full', [], true);
		restoreContentBodyValidation(cache, 'full', saved);
		const read = spyOn(fs, 'readFileSync');
		try {
			const readers = readContentBodies(cache, 'full', [relative], true);
			expect(readers.has(relative)).toBe(true);
			expect(read.mock.calls).toHaveLength(0);
			expect(readers.get(relative)?.()).toEqual(body);
			expect(read.mock.calls).toHaveLength(1);
		} finally {
			read.mockRestore();
		}
		const observed = fs.statSync(file);
		writeFileSync(file, JSON.stringify({ ...body, html: 'corrupted body' }));
		fs.utimesSync(file, observed.atime, observed.mtime);
		// Capturing after mutation must retain the earlier validated observation.
		const stale = captureContentBodyValidation(cache, 'full');
		readContentBodies(cache, 'full', [], true);
		restoreContentBodyValidation(cache, 'full', stale);
		expect(readContentBodies(cache, 'full', [relative], true).has(relative)).toBe(false);
		rmSync(file);
		restoreContentBodyValidation(cache, 'full', saved);
		expect(readContentBodies(cache, 'full', [relative], true).has(relative)).toBe(false);
		const elsewhere = path.join(cache, 'elsewhere.json');
		writeFileSync(elsewhere, JSON.stringify(body));
		symlinkSync(elsewhere, file);
		restoreContentBodyValidation(cache, 'full', saved);
		expect(readContentBodies(cache, 'full', [relative], true).has(relative)).toBe(false);
		readContentBodies(cache, 'full', [], true);
		restoreContentBodyValidation(cache, 'public', saved);
		expect(captureContentBodyValidation(cache, 'full').files).toHaveLength(0);
		for (const invalid of [
			null,
			{},
			{ version: 2, files: saved.files },
			{
				version: 1,
				files: [['../escape', 'identity'], [relative, 123], null]
			}
		])
			restoreContentBodyValidation(cache, 'full', invalid);
		expect(captureContentBodyValidation(cache, 'full').files).toHaveLength(0);
	} finally {
		readContentBodies(cache, 'full', [], true);
		rmSync(cache, { recursive: true, force: true });
	}
});

test('restored document copies skip validated bytes and repair later cache or output changes', () => {
	const site = mkdtempSync(path.join(tmpdir(), 'twiki-restored-doc-'));
	const cache = path.join(site, 'cache');
	const out = path.join(site, 'build/generated/pages/note.json');
	const record = page('note');
	const document = { html: '<p>original document</p>', markdown: 'original document' };
	let creates = 0;
	const emit = (development = true) =>
		emitContentDocument(
			cache,
			'full',
			record,
			'same',
			out,
			() => {
				creates++;
				return document;
			},
			development
		);
	try {
		emit();
		const object = path.join(cache, record.document!);
		const saved = JSON.parse(JSON.stringify(captureContentDocumentValidation(cache, site, 'full')));
		expect(saved.files).toHaveLength(1);
		expect(captureContentDocumentValidation(cache, site, 'public').files).toHaveLength(0);
		const observed = new Map([[out, fs.statSync(out, { bigint: true })]]);
		// Clear development copy state without changing the output bytes or identity.
		emit(false);
		restoreContentDocumentValidation(cache, site, 'full', saved, observed);
		const read = spyOn(fs, 'readFileSync');
		try {
			emit();
			expect(read.mock.calls).toHaveLength(0);
		} finally {
			read.mockRestore();
		}
		writeFileSync(out, 'corrupt output');
		restoreContentDocumentValidation(cache, site, 'full', saved, observed);
		emit();
		expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(document);
		writeFileSync(object, 'corrupt cache');
		// Capturing after mutation must never bless a newer unvalidated source stamp.
		const stale = captureContentDocumentValidation(cache, site, 'full');
		restoreContentDocumentValidation(cache, site, 'full', stale, observed);
		emit();
		expect(creates).toBe(2);
		expect(JSON.parse(readFileSync(object, 'utf8'))).toEqual(document);
		rmSync(object);
		restoreContentDocumentValidation(cache, site, 'full', saved, observed);
		emit();
		expect(creates).toBe(3);
		expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(document);
	} finally {
		rmSync(site, { recursive: true, force: true });
	}
});

test('document copy reuse rejects symlink ancestors even when cached inode and timestamps match', () => {
	const cache = mkdtempSync(path.join(tmpdir(), 'twiki-doc-symlink-'));
	const out = path.join(cache, 'pages/note.json');
	const record = page('note');
	const emit = () =>
		emitContentDocument(cache, 'full', record, 'same', out, () => ({ html: 'body' }), true);
	try {
		emit();
		const directory = path.dirname(path.join(cache, record.document!));
		fs.renameSync(directory, directory + '-moved');
		symlinkSync(directory + '-moved', directory);
		expect(emit).toThrow('owned directory ancestors');
	} finally {
		rmSync(cache, { recursive: true, force: true });
	}
});

test('restored document proofs reject edition changes, malformed state and aliased destinations', () => {
	const site = mkdtempSync(path.join(tmpdir(), 'twiki-doc-proof-boundaries-'));
	const cache = path.join(site, 'cache');
	const out = path.join(site, 'build/generated/pages/note.json');
	const record = page('note');
	const emit = (development = true) =>
		emitContentDocument(cache, 'full', record, 'same', out, () => ({ html: 'body' }), development);
	try {
		emit();
		const saved = captureContentDocumentValidation(cache, site, 'full');
		const observed = new Map([[out, fs.statSync(out, { bigint: true })]]);
		const alias = structuredClone(saved);
		alias.files[0][1] = 'build/generated/pages/../pages/note.json';
		for (const [edition, state] of [
			['public', saved],
			['full', { version: 2, files: saved.files }],
			['full', alias],
			['full', { version: 1, files: [null, [], [123, 'bad', 1, 2]] }]
		] as const) {
			emit(false);
			restoreContentDocumentValidation(cache, site, edition, state, observed);
			const read = spyOn(fs, 'readFileSync');
			try {
				emit();
				expect(read.mock.calls.length).toBeGreaterThan(0);
			} finally {
				read.mockRestore();
			}
		}
	} finally {
		rmSync(site, { recursive: true, force: true });
	}
});

test('document emission skips unchanged bytes and repairs changed or missing cache and output files', () => {
	const cache = mkdtempSync(path.join(tmpdir(), 'twiki-doc-emitter-'));
	const out = path.join(cache, 'pages/note.json');
	const record = page('note');
	const document = { html: 'private note 界', markdown: 'private source' };
	let creates = 0;
	const emit = () =>
		emitContentDocument(
			cache,
			'full',
			record,
			'same-dependencies',
			out,
			() => {
				creates++;
				return document;
			},
			true
		);
	let restore: (() => void) | undefined;
	try {
		expect(emit()).toBe(Buffer.byteLength(JSON.stringify(document)));
		const object = path.join(cache, record.document!);
		const read = spyOn(fs, 'readFileSync');
		restore = () => read.mockRestore();
		expect(emit()).toBe(Buffer.byteLength(JSON.stringify(document)));
		expect(read.mock.calls.filter(([file]) => file === out || file === object)).toHaveLength(0);
		expect(creates).toBe(1);
		read.mockRestore();
		restore = undefined;
		const before = fs.statSync(out);
		writeFileSync(out, JSON.stringify({ html: 'altered note', markdown: 'altered source' }));
		fs.utimesSync(out, before.atime, before.mtime);
		emit();
		expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(document);
		rmSync(out);
		emit();
		expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(document);
		const cached = fs.statSync(object);
		writeFileSync(object, JSON.stringify({ html: 'altered note', markdown: 'altered source' }));
		fs.utimesSync(object, cached.atime, cached.mtime);
		emit();
		expect(creates).toBe(2);
		expect(readContentObject(cache, record.document!, 'full')?.toString()).toBe(
			JSON.stringify(document)
		);
		rmSync(object);
		emit();
		expect(creates).toBe(3);
		emitContentDocument(
			cache,
			'public',
			record,
			'same-dependencies',
			out,
			() => ({ locked: true, html: '' }),
			true
		);
		expect(record.document).toStartWith('content/public/docs/');
		expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual({ locked: true, html: '' });
	} finally {
		restore?.();
		rmSync(cache, { recursive: true, force: true });
	}
});

test('compact index and actual-byte objects survive relocation, enforce edition ownership, and fail cold on corruption', () => {
	const cache = mkdtempSync(path.join(tmpdir(), 'wisconsin-content-cache-'));
	try {
		const body = writeContentObject(
			cache,
			'full',
			'bodies',
			JSON.stringify({ html: '<p>cached</p>', markdown: 'cached' })
		);
		const document = writeContentObject(cache, 'full', 'docs', '{"html":"cached"}');
		const record = { ...page('course/note'), body, document, documentKey: 'b'.repeat(64) };
		writeContentIndex(cache, 'full', {
			schema: 1,
			renderer: 'renderer',
			context: 'c'.repeat(64),
			pages: { [record.summary.rel]: record }
		});
		expect(readContentIndex(cache, 'full', 'renderer')?.pages[record.summary.rel]).toEqual(record);
		expect(readContentIndex(cache, 'full', 'different-renderer')).toBeUndefined();
		expect(readContentBody(cache, body, 'full')).toEqual({
			html: '<p>cached</p>',
			markdown: 'cached'
		});
		expect(readContentObject(cache, document, 'public')).toBeUndefined();
		expect(readContentObject(cache, '../outside.json', 'full')).toBeUndefined();
		expect(
			JSON.parse(readFileSync(path.join(cache, 'content-files-current-full.json'), 'utf8'))
		).toEqual([body, document, 'content-current-full.json'].sort());
		writeFileSync(path.join(cache, body), '{"html":"corrupted","markdown":"cached"}');
		expect(readContentBody(cache, body, 'full')).toBeUndefined();
		const file = path.join(cache, 'content-current-full.json');
		const index = JSON.parse(readFileSync(file, 'utf8'));
		index.pages[record.summary.rel].summary.title = 'corrupted';
		writeFileSync(file, JSON.stringify(index));
		expect(readContentIndex(cache, 'full', 'renderer')).toBeUndefined();
	} finally {
		rmSync(cache, { recursive: true, force: true });
	}
});

test('index byte validation preserves legacy JSON, reformatted caches and escaped metadata', () => {
	const cache = mkdtempSync(path.join(tmpdir(), 'twiki-index-json-'));
	const record = page('course/note');
	record.summary.title = 'Unicode λ, quotes " and checksum-like text ,"checksum":"x"}';
	const index = {
		schema: 1 as const,
		renderer: 'renderer',
		context: 'c'.repeat(64),
		pages: { [record.summary.rel]: record }
	};
	const checksum = contentHash(JSON.stringify(index));
	const file = path.join(cache, 'content-current-full.json');
	try {
		writeContentIndex(cache, 'full', index);
		// Keep the wire format readable by existing engines and cache tools.
		expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ ...index, checksum });
		for (const serialized of [
			JSON.stringify({ ...index, checksum }),
			JSON.stringify({ checksum, ...index }),
			JSON.stringify({ ...index, checksum }, null, 2),
			JSON.stringify({ ...index, checksum }).replace('"schema":1', '"schema": 1')
		]) {
			writeFileSync(file, serialized);
			expect(readContentIndex(cache, 'full', 'renderer')).toEqual(index);
			writeFileSync(file, serialized.replace('Unicode', 'Corrupt'));
			expect(readContentIndex(cache, 'full', 'renderer')).toBeUndefined();
		}
	} finally {
		rmSync(cache, { recursive: true, force: true });
	}
});

test('objects through symlink ancestors are never consumed as cached content', () => {
	const cache = mkdtempSync(path.join(tmpdir(), 'wisconsin-content-symlink-'));
	const outside = mkdtempSync(path.join(tmpdir(), 'wisconsin-content-outside-'));
	try {
		const relative = writeContentObject(outside, 'full', 'docs', '{}');
		symlinkSync(path.join(outside, 'content'), path.join(cache, 'content'));
		expect(readContentObject(cache, relative, 'full')).toBeUndefined();
		expect(() => writeContentObject(cache, 'full', 'docs', '{"new":true}')).toThrow(
			'owned directory ancestors'
		);
		expect(readFileSync(path.join(outside, relative), 'utf8')).toBe('{}');
	} finally {
		rmSync(cache, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test('transclusion invalidation includes missing targets, cycles, and chains beyond render depth', () => {
	const records = [
		page('a', ['b']),
		page('b', ['c']),
		page('c', ['d']),
		page('d', ['e']),
		page('e', ['a', 'missing']),
		page('unrelated')
	];
	const closure = transclusionClosure(records, new Set(['missing']));
	for (const slug of ['missing', 'a', 'b', 'c', 'd', 'e']) expect(closure.has(slug)).toBe(true);
	expect(closure.has('unrelated')).toBe(false);
	expect(contentHash('same')).toBe(contentHash(Buffer.from('same')));
});
