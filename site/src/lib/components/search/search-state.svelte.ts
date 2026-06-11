import { ensureIndex } from './pagefind-client.svelte';

/**
 * Shared palette open state (ported from cca): triggers (header button,
 * `/` and Cmd/Ctrl+K bindings) live in different layout regions from the
 * palette itself.
 */
export const searchState = $state({ open: false });

export function openSearch(): void {
	searchState.open = true;
	void ensureIndex();
}

export function closeSearch(): void {
	searchState.open = false;
}

export function toggleSearch(): void {
	if (searchState.open) closeSearch();
	else openSearch();
}
