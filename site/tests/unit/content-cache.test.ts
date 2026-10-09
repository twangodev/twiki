import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	contentHash,
	readContentBody,
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
