export interface FileTab {
	course: string;
	path: string;
	pinned: boolean;
	top: number;
	left: number;
}

export function sameFile(a: Pick<FileTab, 'course' | 'path'>, b: Pick<FileTab, 'course' | 'path'>) {
	return a.course === b.course && a.path === b.path;
}

export function openFile(tabs: FileTab[], course: string, path: string, pinned = false): FileTab[] {
	const existing = tabs.findIndex((tab) => sameFile(tab, { course, path }));
	if (existing >= 0)
		return tabs.map((tab, i) => (i === existing && pinned ? { ...tab, pinned: true } : tab));
	const next = { course, path, pinned, top: 0, left: 0 };
	const preview = tabs.findIndex((tab) => !tab.pinned);
	return preview < 0 ? [...tabs, next] : tabs.map((tab, i) => (i === preview ? next : tab));
}

export function restoreTabs(value: string | null): FileTab[] {
	try {
		const parsed: unknown = JSON.parse(value ?? '[]');
		if (!Array.isArray(parsed)) return [];
		const tabs: FileTab[] = [];
		for (const tab of parsed.slice(0, 100)) {
			if (
				!tab ||
				typeof tab.course !== 'string' ||
				typeof tab.path !== 'string' ||
				!tab.course ||
				!tab.path ||
				tab.course.length > 200 ||
				tab.path.length > 2000
			)
				continue;
			if (tabs.some((existing) => sameFile(existing, tab))) continue;
			tabs.push({
				course: tab.course,
				path: tab.path,
				pinned: tab.pinned === true || tabs.some((item) => !item.pinned),
				top: Number.isFinite(tab.top) ? Math.max(0, tab.top) : 0,
				left: Number.isFinite(tab.left) ? Math.max(0, tab.left) : 0
			});
		}
		return tabs;
	} catch {
		return [];
	}
}

export function moveTab(tabs: FileTab[], tab: FileTab, destination: number): FileTab[] {
	const index = tabs.findIndex((item) => sameFile(item, tab));
	if (index < 0 || !Number.isInteger(destination)) return tabs;
	if (index === destination && tabs[index].pinned) return tabs;
	const reordered = [...tabs];
	const [moved] = reordered.splice(index, 1);
	reordered.splice(Math.max(0, Math.min(destination, reordered.length)), 0, {
		...moved,
		pinned: true
	});
	return reordered;
}

export function tabLabel(tab: FileTab, tabs: FileTab[]) {
	const name = tab.path.split('/').at(-1)!;
	const duplicate = tabs.some(
		(other) => !sameFile(tab, other) && other.path.split('/').at(-1) === name
	);
	return duplicate ? `${name} · ${tab.course}/${tab.path.split('/').slice(0, -1).join('/')}` : name;
}
