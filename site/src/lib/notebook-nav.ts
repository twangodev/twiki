import { fileRoute, type CourseFile } from './files';
import type { NavNode } from './types';

/** Add executable worksheets to Notes without treating datasets as notes. */
export function addNotebookNavigation(nav: NavNode[], course: string, files: CourseFile[]) {
	const notebooks = files.filter((file) => /\.rmd$/i.test(file.path));
	if (!notebooks.length) return;
	let root = nav.find((node) => node.segment === course);
	if (!root) {
		root = { segment: course, title: course, route: fileRoute(course), children: [] };
		nav.push(root);
	}
	for (const file of notebooks) {
		const parts = file.path.split('/');
		let children = root.children;
		for (let i = 0; i < parts.length - 1; i++) {
			const segment = parts[i];
			let folder = children.find((node) => node.segment === segment);
			if (!folder) {
				folder = {
					segment,
					title: segment.charAt(0).toUpperCase() + segment.slice(1),
					route: fileRoute(course, parts.slice(0, i + 1).join('/')),
					notebook: true,
					children: []
				};
				children.push(folder);
			}
			children = folder.children;
		}
		const segment = parts.at(-1)!;
		if (!children.some((node) => node.segment === segment))
			children.push({
				segment,
				title:
					segment
						.replace(/\.rmd$/i, '')
						.replace(/[-_]/g, ' ')
						.replace(/^./, (c) => c.toUpperCase()) + ' (R worksheet)',
				route: fileRoute(course, file.path),
				notebook: true,
				locked: file.locked,
				children: []
			});
	}
	function sort(nodes: NavNode[]) {
		nodes.sort(
			(a, b) =>
				Number(!!b.children.length) - Number(!!a.children.length) ||
				a.title.localeCompare(b.title, undefined, { numeric: true })
		);
		for (const node of nodes) sort(node.children);
	}
	sort(root.children);
}

export function isNotebookRoute(nodes: NavNode[], path: string): boolean {
	return nodes.some(
		(node) =>
			(node.notebook && decodeURI(node.route ?? '') === path.replace(/\/$/, '')) ||
			isNotebookRoute(node.children, path)
	);
}
