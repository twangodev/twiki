import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	assetContentProvider,
	emptyContentProvider,
	localContentProvider
} from '../../src/lib/server/content-provider';
import type { ContentContext } from '../../src/lib/server/content-provider';
import type { ContentManifest, PageDoc } from '../../src/lib/types';

const applicationVersion = 'a'.repeat(64);
function context(edition: 'public' | 'full', snapshot = 'b'.repeat(64)): ContentContext {
	return { edition, snapshot, applicationVersion };
}
function page(slug: string, title: string, published = true): PageDoc {
	return {
		slug,
		title,
		publication: { public: published },
		description: '',
		tags: ['course'],
		dates: { created: '2026-01-01', modified: '2026-01-02', published: '2026-01-01' },
		links: [],
		backlinks: [],
		wordCount: 1,
		readingTime: 1,
		hasMermaid: false,
		relativePath: `${slug}.md`,
		toc: [],
		html: `<p>${title}</p>`
	};
}
function manifest(docs: PageDoc[]): ContentManifest {
	return {
		generatedAt: '',
		counts: { pages: docs.length },
		pages: Object.fromEntries(docs.map((doc) => [doc.slug, { ...doc, backlinks: [] }])),
		folders: [],
		tags: { course: docs.map((doc) => doc.slug) },
		assets: [],
		htmlAssets: [],
		tree: {
			name: '',
			slug: '',
			title: '',
			children: [],
			pages: docs.map((doc) => ({ slug: doc.slug, title: doc.title }))
		},
		graph: { nodes: [], links: [] }
	};
}
function platform(
	assets: { fetch(request: Request): Promise<Response> },
	selection: ContentContext
) {
	return { env: { ASSETS: assets, WISCONSIN_CONTENT_CONTEXT: selection } };
}

test('concurrent editions and snapshots share a binding without sharing content', async () => {
	const seen: string[] = [];
	const assets = {
		async fetch(request: Request) {
			const pathname = new URL(request.url).pathname;
			seen.push(pathname);
			await Promise.resolve();
			const title = pathname.includes('/full/') ? 'PRIVATE CANARY' : 'Published';
			const doc = page('course/note', title, !pathname.includes('/full/'));
			return Response.json(
				pathname.endsWith('/manifest.json')
					? manifest([doc])
					: pathname.endsWith('/nav.json')
						? [{ title }]
						: doc
			);
		}
	};
	const published = assetContentProvider(platform(assets, context('public')));
	const full = assetContentProvider(platform(assets, context('full')));
	const [publicPage, privatePage, publicNav, privateNav] = await Promise.all([
		published.page('course/note'),
		full.page('course/note'),
		published.nav(),
		full.nav()
	]);
	expect(publicPage.title).toBe('Published');
	expect(privatePage.title).toBe('PRIVATE CANARY');
	expect(publicNav[0].title).toBe('Published');
	expect(privateNav[0].title).toBe('PRIVATE CANARY');
	expect(seen.filter((file) => file.includes('/public/'))).toHaveLength(3);
	expect(seen.filter((file) => file.includes('/full/'))).toHaveLength(3);
	expect(assetContentProvider(platform(assets, context('public')))).toBe(published);
	expect(assetContentProvider(platform(assets, context('public', 'c'.repeat(64))))).not.toBe(
		published
	);
});

test('trusted context is mandatory and page paths cannot traverse snapshots', async () => {
	const seen: string[] = [];
	const assets = {
		async fetch(request: Request) {
			seen.push(request.url);
			return Response.json(manifest([]));
		}
	};
	expect(() => assetContentProvider({ env: { ASSETS: assets } })).toThrow(
		'trusted content context'
	);
	for (const snapshot of ['../full', '', 'abc', 'B'.repeat(64)])
		expect(() => assetContentProvider(platform(assets, context('public', snapshot)))).toThrow();
	const content = assetContentProvider(platform(assets, context('public')));
	for (const slug of [
		'../note',
		'course/../note',
		'/note',
		'course\\note',
		'course//note',
		'note\0'
	])
		await expect(content.page(slug)).rejects.toThrow('Invalid content slug');
	expect(seen).toHaveLength(0);
	await expect(content.page('private/note')).rejects.toThrow('Unknown content page');
	expect(seen).toHaveLength(1); // Only the selected public manifest was requested.
	expect((await content.model()).pageSlugForRoute('constructor')).toBeUndefined();
});

test('a binding retains only two recently used edition snapshots', async () => {
	let reads = 0;
	const assets = {
		async fetch() {
			reads++;
			return Response.json([]);
		}
	};
	const first = assetContentProvider(platform(assets, context('public')));
	const full = assetContentProvider(platform(assets, context('full')));
	await first.nav();
	assetContentProvider(platform(assets, context('public', 'c'.repeat(64))));
	expect(assetContentProvider(platform(assets, context('full')))).toBe(full);
	const replacement = assetContentProvider(platform(assets, context('public')));
	expect(replacement).not.toBe(first);
	await replacement.nav();
	expect(reads).toBe(2);
});

test('public provider rejects a private PageDoc accidentally placed in its namespace', async () => {
	const doc = page('course/note', 'PRIVATE CANARY', false);
	const assets = {
		async fetch(request: Request) {
			return Response.json(
				new URL(request.url).pathname.endsWith('/manifest.json') ? manifest([doc]) : doc
			);
		}
	};
	await expect(
		assetContentProvider(platform(assets, context('public'))).page(doc.slug)
	).rejects.toThrow('Private content');
	doc.locked = true;
	doc.html = '';
	doc.heading = 'Public heading outline';
	doc.toc = [{ depth: 0, text: 'Public heading outline', slug: 'public-heading-outline' }];
	const lockedAssets = {
		async fetch(request: Request) {
			return Response.json(
				new URL(request.url).pathname.endsWith('/manifest.json') ? manifest([doc]) : doc
			);
		}
	};
	const locked = await assetContentProvider(platform(lockedAssets, context('public'))).page(
		doc.slug
	);
	expect(locked.locked).toBe(true);
	expect(locked.heading).toBe('Public heading outline');
	expect(locked.toc).toEqual(doc.toc);
});

test('Unicode and literal percent filenames are encoded once and failed reads retry', async () => {
	const doc = page('course/café %/Résumé #', 'Unicode');
	const seen: string[] = [];
	let failed = false;
	const assets = {
		async fetch(request: Request) {
			const file = new URL(request.url).pathname;
			seen.push(file);
			if (file.endsWith('/manifest.json')) return Response.json(manifest([doc]));
			if (!failed) {
				failed = true;
				return new Response('Unavailable', { status: 503 });
			}
			return Response.json(doc);
		}
	};
	const content = assetContentProvider(platform(assets, context('public')));
	await expect(content.page(doc.slug)).rejects.toThrow('unavailable');
	expect((await content.page(doc.slug)).title).toBe('Unicode');
	expect(seen[1]).toEndWith('/pages/course/caf%C3%A9%20%25/R%C3%A9sum%C3%A9%20%23.json');
	expect(seen[2]).toBe(seen[1]);
});

test('page cache bounds entry bookkeeping and fetches concurrent misses once', async () => {
	const docs = Array.from({ length: 70 }, (_, index) =>
		page(`course/note-${index}`, `Note ${index}`)
	);
	const seen: string[] = [];
	const assets = {
		async fetch(request: Request) {
			const file = new URL(request.url).pathname;
			seen.push(file);
			await Promise.resolve();
			if (file.endsWith('/manifest.json')) return Response.json(manifest(docs));
			return Response.json(docs.find((doc) => file.endsWith(`/pages/${doc.slug}.json`)));
		}
	};
	const content = assetContentProvider(platform(assets, context('full')));
	await Promise.all([content.page(docs[0].slug), content.page(docs[0].slug)]);
	expect(seen).toHaveLength(2);
	for (const doc of docs.slice(1)) await content.page(doc.slug);
	await content.page(docs[0].slug);
	expect(seen.filter((file) => file.endsWith('/pages/course/note-0.json'))).toHaveLength(2);
});

test('oversized documents share an in-flight read but are not retained', async () => {
	const doc = page('course/large', 'Large note');
	const index = manifest([doc]);
	doc.html = 'x'.repeat(6 * 1024 * 1024);
	let reads = 0;
	const assets = {
		async fetch(request: Request) {
			if (new URL(request.url).pathname.endsWith('/manifest.json')) return Response.json(index);
			reads++;
			return Response.json(doc);
		}
	};
	const content = assetContentProvider(platform(assets, context('full')));
	const [first, concurrent] = await Promise.all([content.page(doc.slug), content.page(doc.slug)]);
	expect(first.html.length).toBe(doc.html.length);
	expect(concurrent).toBe(first);
	expect(reads).toBe(1);
	await content.page(doc.slug);
	expect(reads).toBe(2);
});

test('metadata shares one byte budget across bindings and snapshots', async () => {
	function navigation() {
		let reads = 0;
		const assets = {
			async fetch() {
				reads++;
				return Response.json([{ title: 'x'.repeat(3 * 1024 * 1024) }]);
			}
		};
		return {
			content: assetContentProvider(platform(assets, context('full'))),
			reads: () => reads
		};
	}
	const first = navigation();
	const second = navigation();
	await first.content.nav();
	await second.content.nav();
	expect(first.reads()).toBe(1);
	expect(second.reads()).toBe(1);
	await first.content.nav();
	expect(first.reads()).toBe(2);
});

test('distinct pending reads are bounded and failed capacity checks can retry', async () => {
	const docs = Array.from({ length: 40 }, (_, index) => page(`course/queued-${index}`, 'Note'));
	const gate = Promise.withResolvers<void>();
	const started = Promise.withResolvers<void>();
	let active = 0;
	let peak = 0;
	let reads = 0;
	const assets = {
		async fetch(request: Request) {
			const file = new URL(request.url).pathname;
			if (file.endsWith('/manifest.json')) return Response.json(manifest(docs));
			active++;
			reads++;
			peak = Math.max(peak, active);
			if (reads === 2) started.resolve();
			await gate.promise;
			active--;
			return Response.json(docs.find((doc) => file.endsWith(`/pages/${doc.slug}.json`)));
		}
	};
	const content = assetContentProvider(platform(assets, context('full')));
	await content.manifest();
	const pending = Promise.allSettled(docs.map((doc) => content.page(doc.slug)));
	await started.promise;
	expect(reads).toBe(2);
	gate.resolve();
	const results = await pending;
	expect(peak).toBe(2);
	expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(32);
	const rejected = results.filter((result) => result.status === 'rejected');
	expect(rejected).toHaveLength(8);
	expect(rejected.every((result) => result.reason.message.includes('temporarily busy'))).toBe(true);
	expect((await content.page(docs[39].slug)).slug).toBe(docs[39].slug);
});

test('local providers see new generated bytes while application-only fallback reads none', async () => {
	const site = mkdtempSync(path.join(tmpdir(), 'wisconsin-runtime-content-'));
	try {
		mkdirSync(path.join(site, 'build/generated/pages/course'), { recursive: true });
		mkdirSync(path.join(site, 'src/lib/generated'), { recursive: true });
		const doc = page('course/note', 'Initial');
		writeFileSync(
			path.join(site, 'build/generated/content-manifest.json'),
			JSON.stringify(manifest([doc]))
		);
		writeFileSync(path.join(site, 'build/generated/pages/course/note.json'), JSON.stringify(doc));
		writeFileSync(path.join(site, 'src/lib/generated/nav.json'), '[]');
		expect((await localContentProvider(site, 'full').page(doc.slug)).title).toBe('Initial');
		doc.title = 'Updated';
		writeFileSync(path.join(site, 'build/generated/pages/course/note.json'), JSON.stringify(doc));
		expect((await localContentProvider(site, 'full').page(doc.slug)).title).toBe('Updated');
		const empty = emptyContentProvider();
		expect(await empty.nav()).toEqual([]);
		expect((await empty.manifest()).pages).toEqual({});
		await expect(empty.page('course/note')).rejects.toThrow('Unknown content page');
	} finally {
		rmSync(site, { recursive: true, force: true });
	}
});
