import { getContext, setContext } from 'svelte';
import { goto } from '$app/navigation';
import { fileRoute } from '$lib/files';
import { moveTab, openFile, restoreTabs, sameFile, type FileTab } from '$lib/file-tabs';
import { publicEdition } from '$lib/publication';

const context = Symbol('file-workspace');
const storageKey = publicEdition ? 'wisconsin-public-file-tabs' : 'wisconsin-file-tabs';

class FileWorkspace {
	tabs = $state<FileTab[]>([]);
	ready = $state(false);
	private lastClick?: { course: string; path: string; time: number };
	private touchNavigation?: ReturnType<typeof setTimeout>;

	activate(event: MouseEvent, course: string, path: string) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
			return;
		const repeated =
			event.detail > 0 &&
			this.lastClick &&
			sameFile(this.lastClick, { course, path }) &&
			event.timeStamp - this.lastClick.time < 500;
		const pinned = event.detail > 1 || !!repeated;
		this.lastClick =
			pinned || event.detail === 0 ? undefined : { course, path, time: event.timeStamp };
		this.open(course, path, pinned);
		if ('pointerType' in event && event.pointerType === 'touch') {
			event.preventDefault();
			clearTimeout(this.touchNavigation);
			if (pinned) void goto(fileRoute(course, path));
			else
				this.touchNavigation = setTimeout(() => {
					void goto(fileRoute(course, path));
				}, 300);
		}
	}

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

	move(tab: FileTab, destination: number) {
		this.lastClick = undefined;
		const reordered = moveTab(this.tabs, tab, destination);
		if (reordered === this.tabs) return;
		this.tabs = reordered;
		this.save();
	}

	clear() {
		clearTimeout(this.touchNavigation);
		this.lastClick = undefined;
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
