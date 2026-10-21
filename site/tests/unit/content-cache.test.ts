import { expect, test, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	contentHash,
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

test('document emission skips unchanged bytes and repairs changed or missing cache and output files', () => {
	const cache = mkdtempSync(path.join(tmpdir(), 'twiki-doc-emitter-'));
	const out = path.join(cache, 'pages/note.json');
	const record = page('note');
	const document = { html: 'private note', markdown: 'private source' };
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
		emit();
		const object = path.join(cache, record.document!);
		const read = spyOn(fs, 'readFileSync');
		restore = () => read.mockRestore();
		emit();
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
