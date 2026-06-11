import type { TocEntry } from '$lib/types';

/**
 * Shared reactive table-of-contents state. The page route populates this from
 * the manifest's build-time TOC; the route layout's right-hand TOC rail reads
 * it. Using a module-level rune store keeps the sidebar/TOC shell in the
 * persistent route layout while still reacting to per-page content.
 */
export const tocState = $state<{ items: TocEntry[] }>({ items: [] });

export function setToc(items: TocEntry[]): void {
	tocState.items = items;
}

export function clearToc(): void {
	tocState.items = [];
}
