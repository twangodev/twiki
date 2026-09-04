import { cleanResultUrl } from './pagefind-url';

/**
 * Lazy Pagefind client (cca's `search-client.svelte.ts` rewired from
 * minisearch to Pagefind's chunked static index).
 *
 * The index is produced AFTER `vite build` by `bun run build:search`
 * (`pagefind --site .svelte-kit/cloudflare`), which drops a self-contained
 * `/pagefind/` bundle into the deployed static assets. We lazy-import its JS
 * API on first palette open, so search costs nothing until used. The Vite dev
 * server never has that bundle — `status: 'missing'` drives the dev fallback
 * message in the palette.
 */

/* Minimal typings for the Pagefind browser API (no published types). */
interface PagefindSubResult {
	title: string;
	url: string;
	excerpt: string;
}

interface PagefindFragment {
	url: string;
	excerpt: string;
	meta: Record<string, string>;
	sub_results: PagefindSubResult[];
}

interface PagefindRawResult {
	id: string;
	data(): Promise<PagefindFragment>;
}

interface PagefindModule {
	init(): Promise<void>;
	options(opts: Record<string, unknown>): Promise<void>;
	filters(): Promise<Record<string, Record<string, number>>>;
	search(
		query: string | null,
		options?: { filters?: Record<string, string[]> }
	): Promise<{ results: PagefindRawResult[] }>;
	debouncedSearch(
		query: string,
		options?: { filters?: Record<string, string[]> },
		debounceMs?: number
	): Promise<{ results: PagefindRawResult[] } | null>;
}

/** One section-level hit (deep link) within a page. */
export interface SearchSection {
	title: string;
	url: string;
	/** Pagefind-generated excerpt HTML (`<mark>` around matched terms). */
	excerpt: string;
}

/** Search hits grouped by page and section. */
export interface SearchGroup {
	id: string;
	title: string;
	url: string;
	sections: SearchSection[];
}

export const searchClient = $state<{
	status: 'idle' | 'loading' | 'ready' | 'missing';
	/** filter name -> value -> result count, from the built index. */
	filters: Record<string, Record<string, number>>;
}>({ status: 'idle', filters: {} });

let pagefind: PagefindModule | undefined;

export async function ensureIndex(): Promise<void> {
	if (searchClient.status === 'ready' || searchClient.status === 'loading') return;
	searchClient.status = 'loading';
	try {
		// Runtime URL import — kept out of Vite's module graph on purpose.
		const bundleUrl = '/pagefind/pagefind.js';
		pagefind = (await import(/* @vite-ignore */ bundleUrl)) as PagefindModule;
		await pagefind.init();
		searchClient.filters = await pagefind.filters();
		searchClient.status = 'ready';
	} catch {
		pagefind = undefined;
		searchClient.status = 'missing';
	}
}

/** Allow the palette's Retry button to re-attempt a failed load. */
export function resetIndex(): void {
	if (searchClient.status === 'missing') searchClient.status = 'idle';
}

const PAGE_LIMIT = 10;
const SECTIONS_PER_PAGE = 4;

/**
 * Run a debounced Pagefind query. Returns `null` when this call was
 * superseded by a newer keystroke (Pagefind's debouncedSearch contract) —
 * callers must keep previous results in that case.
 */
export async function searchPagefind(
	query: string | null,
	filters: Record<string, string[]>
): Promise<SearchGroup[] | null> {
	if (!pagefind) return [];
	const opts = Object.keys(filters).length > 0 ? { filters } : undefined;
	const res =
		query === null
			? await pagefind.search(null, opts)
			: await pagefind.debouncedSearch(query, opts, 120);
	if (res === null) return null;

	const top = res.results.slice(0, PAGE_LIMIT);
	const fragments = await Promise.all(top.map((r) => r.data()));
	return fragments.map((frag, i) => {
		const url = cleanResultUrl(frag.url);
		const title = frag.meta?.title || url;
		let sections: SearchSection[] = (frag.sub_results ?? [])
			.slice(0, SECTIONS_PER_PAGE)
			.map((sub) => ({
				title: sub.title || title,
				url: cleanResultUrl(sub.url),
				excerpt: sub.excerpt
			}));
		if (sections.length === 0) sections = [{ title, url, excerpt: frag.excerpt }];
		return { id: top[i].id, title, url, sections };
	});
}
