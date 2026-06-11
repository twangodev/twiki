import { browser } from '$app/environment';

/**
 * ReaderMode (fork-custom Quartz feature, rebuilt Svelte-native): a global
 * runes store backing a header/sidebar toggle. When enabled, DocShell hides
 * the Explorer sidebar and TOC rails so the article gets a distraction-free
 * single column. Improves on Quartz (which reset on every full page load) by
 * persisting to localStorage.
 */

const STORAGE_KEY = 'readerMode';

function initial(): boolean {
	if (!browser) return false;
	try {
		return localStorage.getItem(STORAGE_KEY) === 'true';
	} catch {
		return false;
	}
}

class ReaderModeState {
	enabled = $state(initial());

	toggle(): void {
		this.set(!this.enabled);
	}

	set(value: boolean): void {
		this.enabled = value;
		if (!browser) return;
		try {
			localStorage.setItem(STORAGE_KEY, String(value));
		} catch {
			// storage unavailable (private mode) — session-only toggle
		}
	}
}

export const readerMode = new ReaderModeState();
