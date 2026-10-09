import type { ContentManifest, NavNode, PageDoc } from '../types';
import type { FileIconTheme } from '../file-icons';
import { createContentModel } from './content-model';

export interface ContentContext {
	edition: 'public' | 'full';
	snapshot: string;
	applicationVersion: string;
}

export interface ContentProvider {
	context: ContentContext;
	manifest(): Promise<ContentManifest>;
	page(slug: string): Promise<PageDoc>;
	nav(): Promise<NavNode[]>;
	icons(): Promise<FileIconTheme>;
	model(): Promise<ReturnType<typeof createContentModel>>;
}

type Assets = { fetch(request: Request): Promise<Response> };
type ContentPlatform = { env: { ASSETS: Assets; WISCONSIN_CONTENT_CONTEXT?: ContentContext } };
const providers = new WeakMap<Assets, Map<string, ContentProvider>>();
const releaseProvider = new WeakMap<ContentProvider, () => void>();
const digest = /^[a-f0-9]{64}$/;
const memoryBudget = 16 * 1024 * 1024;
const entryOverhead = 512;
const maximumPendingReads = 32;
const maximumActiveReads = 2;
type CacheEntry = {
	promise: Promise<unknown>;
	cost: number;
	pending: boolean;
	remove: () => void;
};
// The budget belongs to the isolate, rather than each binding or snapshot.
const retained = new Map<CacheEntry, true>();
let retainedBytes = 0;
let pendingReads = 0;
let activeReads = 0;
const readQueue: Array<() => void> = [];

function discard(entry: CacheEntry) {
	if (retained.delete(entry)) retainedBytes -= entry.cost;
	entry.remove();
}

function touch(entry: CacheEntry) {
	if (retained.delete(entry)) retained.set(entry, true);
}

function trim() {
	for (const entry of retained.keys()) {
		if (retainedBytes <= memoryBudget) break;
		if (!entry.pending) discard(entry);
	}
}

function readBounded(read: () => Promise<unknown>): Promise<unknown> {
	if (pendingReads >= maximumPendingReads)
		return Promise.reject(new Error('Content reads temporarily busy'));
	pendingReads++;
	return new Promise((resolve, reject) => {
		const start = () => {
			activeReads++;
			void Promise.resolve()
				.then(read)
				.then(resolve, reject)
				.finally(() => {
					pendingReads--;
					activeReads--;
					readQueue.shift()?.();
				});
		};
		if (activeReads < maximumActiveReads) start();
		else readQueue.push(start);
	});
}

function validContext(context: ContentContext | undefined): context is ContentContext {
	return (
		!!context &&
		(context.edition === 'public' || context.edition === 'full') &&
		typeof context.snapshot === 'string' &&
		typeof context.applicationVersion === 'string' &&
		digest.test(context.snapshot) &&
		digest.test(context.applicationVersion)
	);
}

/** Only canonical compiler slugs become internal asset paths. */
function pageFile(slug: string) {
	if (
		!slug ||
		slug.includes('\\') ||
		slug.includes('\0') ||
		slug.split('/').some((segment) => !segment || segment === '.' || segment === '..')
	)
		throw new Error('Invalid content slug');
	return `pages/${slug.split('/').map(encodeURIComponent).join('/')}.json`;
}

function provider(
	context: ContentContext,
	read: (file: string) => Promise<unknown>
): ContentProvider {
	const cache = new Map<string, CacheEntry>();
	function json<T>(file: string): Promise<T> {
		const cached = cache.get(file);
		if (cached) {
			cache.delete(file);
			cache.set(file, cached);
			touch(cached);
			return cached.promise as Promise<T>;
		}
		if (pendingReads >= maximumPendingReads)
			return Promise.reject(new Error('Content reads temporarily busy'));
		const entry: CacheEntry = {
			promise: readBounded(() => read(file)),
			cost: entryOverhead,
			pending: true,
			remove: () => {
				if (cache.get(file) === entry) cache.delete(file);
			}
		};
		entry.promise = entry.promise.then(
			(value) => {
				entry.pending = false;
				if (cache.get(file) !== entry) return value;
				// Conservative parsed-object estimate; oversized documents remain usable
				// by active requests but are never kept for subsequent requests.
				const cost = JSON.stringify(value).length * 3 + entryOverhead;
				if (cost > memoryBudget) discard(entry);
				else {
					retainedBytes += cost - entry.cost;
					entry.cost = cost;
					trim();
				}
				return value;
			},
			(error) => {
				discard(entry);
				throw error;
			}
		);
		cache.set(file, entry);
		retained.set(entry, true);
		retainedBytes += entry.cost;
		// A secondary entry bound also limits bookkeeping for many tiny documents.
		for (const candidate of cache.values()) {
			if (cache.size <= 64) break;
			if (!candidate.pending) discard(candidate);
		}
		trim();
		return entry.promise as Promise<T>;
	}
	const result: ContentProvider = {
		context,
		manifest: () => json<ContentManifest>('manifest.json'),
		async page(slug) {
			const file = pageFile(slug);
			const manifest = await result.manifest();
			if (!Object.hasOwn(manifest.pages, slug)) throw new Error('Unknown content page');
			const page = await json<PageDoc>(file);
			if (page.slug !== slug) throw new Error('Content page does not match snapshot');
			if (page.publication.public !== manifest.pages[slug].publication.public)
				throw new Error('Content publication does not match snapshot');
			if (
				context.edition === 'public' &&
				!page.publication.public &&
				(!page.locked || page.html || page.markdown || page.description)
			)
				throw new Error('Private content in public snapshot');
			return page;
		},
		nav: () => json<NavNode[]>('nav.json'),
		icons: () => json<FileIconTheme>('file-icons.json'),
		// Keep projections request-local so they cannot retain an evicted manifest.
		model: () => result.manifest().then(createContentModel)
	};
	releaseProvider.set(result, () => {
		for (const entry of cache.values()) discard(entry);
	});
	return result;
}

/** Application-only builds may render a 404 shell without a content checkout. */
export function emptyContentProvider(): ContentProvider {
	const manifest: ContentManifest = {
		generatedAt: '',
		counts: {},
		pages: {},
		folders: [],
		tags: {},
		assets: [],
		htmlAssets: [],
		tree: { name: '', slug: '', title: '', children: [], pages: [] },
		graph: { nodes: [], links: [] }
	};
	const file = { light: 'file', dark: 'file' };
	const folder = {
		light: 'folder',
		dark: 'folder',
		expanded: { light: 'folder-open', dark: 'folder-open' }
	};
	return provider(
		{ edition: 'public', snapshot: 'application-shell', applicationVersion: 'application-shell' },
		async (fileName) => {
			if (fileName === 'manifest.json') return manifest;
			if (fileName === 'nav.json') return [];
			if (fileName === 'file-icons.json') return { file, folder, files: {}, folders: {} };
			throw new Error('No content in application-only build');
		}
	);
}

/** Context is supplied by the authenticated Worker, never by a client header or URL. */
export function assetContentProvider(platform: ContentPlatform): ContentProvider {
	const context = platform.env.WISCONSIN_CONTENT_CONTEXT;
	if (!validContext(context)) throw new Error('Missing trusted content context');
	const assets = platform.env.ASSETS;
	if (!assets || typeof assets.fetch !== 'function')
		throw new Error('Missing content assets binding');
	let snapshots = providers.get(assets);
	if (!snapshots) providers.set(assets, (snapshots = new Map()));
	const key = `${context.edition}:${context.snapshot}:${context.applicationVersion}`;
	const cached = snapshots.get(key);
	if (cached) {
		snapshots.delete(key);
		snapshots.set(key, cached);
		return cached;
	}
	const selected = Object.freeze({ ...context });
	const root = `/_content/${selected.edition}/${selected.snapshot}/`;
	const result = provider(selected, async (file) => {
		const response = await assets.fetch(
			new Request(`https://wisconsin-content.internal${root}${file}`)
		);
		if (response.status !== 200) throw new Error('Content snapshot unavailable');
		return response.json();
	});
	snapshots.set(key, result);
	// Keep a bounded number of snapshots without sharing public/full data.
	if (snapshots.size > 2) {
		const oldest = snapshots.keys().next().value!;
		releaseProvider.get(snapshots.get(oldest)!)?.();
		snapshots.delete(oldest);
	}
	return result;
}

/** Async filesystem provider is exclusively selected by local development/static export. */
export function localContentProvider(
	site: string,
	edition: ContentContext['edition']
): ContentProvider {
	return provider({ edition, snapshot: 'local', applicationVersion: 'local' }, async (file) => {
		const { readFile } = await import('node:fs/promises');
		const relative =
			file === 'manifest.json'
				? 'build/generated/content-manifest.json'
				: file === 'nav.json' || file === 'file-icons.json'
					? `src/lib/generated/${file}`
					: `build/generated/${file.split('/').map(decodeURIComponent).join('/')}`;
		return JSON.parse(await readFile(`${site}/${relative}`, 'utf8'));
	});
}
