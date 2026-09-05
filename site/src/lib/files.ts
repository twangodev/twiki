export interface CourseFile {
	path: string;
	size: number;
	kind: 'text' | 'image' | 'pdf' | 'binary';
	download?: string;
	note?: string;
}

export interface FilePreview {
	text: string;
}

export interface FileNode {
	name: string;
	path: string;
	children?: FileNode[];
	file?: CourseFile;
}

export function fileRoute(course: string, path = '') {
	return `/${encodeURIComponent(course)}/files${path ? '/' + path.split('/').map(encodeURIComponent).join('/') : ''}`;
}

export function fileIndexUrl(course: string) {
	return `/_files/index/${encodeURIComponent(course)}.json`;
}

export function fileTree(files: CourseFile[]): FileNode[] {
	const root: FileNode[] = [];
	for (const file of files) {
		const segments = file.path.split('/');
		let children = root;
		for (let i = 0; i < segments.length; i++) {
			const name = segments[i];
			let node = children.find((entry) => entry.name === name);
			if (!node) {
				node = { name, path: segments.slice(0, i + 1).join('/') };
				children.push(node);
			}
			if (i === segments.length - 1) node.file = file;
			else children = node.children ??= [];
		}
	}
	function sort(nodes: FileNode[]) {
		nodes.sort(
			(a, b) =>
				Number(!!b.children) - Number(!!a.children) ||
				a.name.localeCompare(b.name, undefined, { numeric: true })
		);
		for (const node of nodes) if (node.children) sort(node.children);
	}
	sort(root);
	return root;
}

export function directoryEntries(tree: FileNode[], path: string): FileNode[] | undefined {
	let entries: FileNode[] | undefined = tree;
	for (const segment of path.split('/').filter(Boolean)) {
		entries = entries?.find((node) => node.name === segment)?.children;
	}
	return entries;
}

export function fileSize(bytes: number) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1048576).toFixed(1)} MB`;
}
