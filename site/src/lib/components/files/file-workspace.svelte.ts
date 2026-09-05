import { getContext, setContext } from 'svelte';
import { openFile, restoreTabs, sameFile, type FileTab } from '$lib/file-tabs';

const context = Symbol('file-workspace');
const storageKey = 'wisconsin-file-tabs';

class FileWorkspace {
	tabs = $state<FileTab[]>([]);
	ready = $state(false);

	restore() {
		try {
			this.tabs = restoreTabs(sessionStorage.getItem(storageKey));
		} catch {
			this.tabs = [];
		}
		this.ready = true;
	}

	private save() {
		if (!this.ready) return;
		try {
			sessionStorage.setItem(storageKey, JSON.stringify(this.tabs));
		} catch {}
	}

	open(course: string, path: string, pinned = false) {
		this.tabs = openFile(this.tabs, course, path, pinned);
		this.save();
	}

	remember(course: string, path: string, viewport: HTMLElement) {
		this.tabs = this.tabs.map((tab) =>
			sameFile(tab, { course, path })
				? { ...tab, top: viewport.scrollTop, left: viewport.scrollLeft }
				: tab
		);
		this.save();
	}

	close(tab: FileTab) {
		const index = this.tabs.findIndex((item) => sameFile(item, tab));
		this.tabs = this.tabs.filter((item) => !sameFile(item, tab));
		this.save();
		return this.tabs[Math.min(index, this.tabs.length - 1)];
	}

	clear() {
		this.tabs = [];
		this.save();
	}
}

export function provideFileWorkspace() {
	return setContext(context, new FileWorkspace());
}

export function fileWorkspace() {
	return getContext<FileWorkspace>(context);
}
