import type { NavigationSettings } from '../../tooling/lib/project-schema';
import type { NavNode } from './types';

/** Explicit grouping also recognizes courses containing only an overview page. */
export function isCourse(node: NavNode, navigation: NavigationSettings): boolean {
	return (
		node.children.length > 0 ||
		(navigation.grouping.mode === 'patterns' &&
			navigation.grouping.groups.some(
				(group) =>
					group.courses?.includes(node.segment) ||
					(group.match && new RegExp(group.match).test(node.segment))
			))
	);
}

/** Semester conventions stay the default; custom groups never change course paths. */
export function courseLabel(node: NavNode, navigation: NavigationSettings): string {
	if (navigation.mode === 'sections' || navigation.grouping.mode !== 'semester')
		return node.title === node.segment ? node.title.replace(/[-_]+/g, ' ') : node.title;
	return node.segment
		.replace(/^(sp|su|fa|wi)\d{2}-/, '')
		.replace(/([a-z])(\d)/, '$1 $2')
		.toUpperCase();
}

export function courseGroup(
	node: NavNode,
	navigation: NavigationSettings
): { label: string; order: number } {
	const { grouping } = navigation;
	if (grouping.mode === 'none') return { label: '', order: 0 };
	if (grouping.mode === 'patterns') {
		const index = grouping.groups.findIndex(
			(group) =>
				group.courses?.includes(node.segment) ||
				(group.match && new RegExp(group.match).test(node.segment))
		);
		return index >= 0
			? { label: grouping.groups[index].label, order: index }
			: { label: grouping.fallback, order: grouping.groups.length };
	}
	const match = /^(sp|su|fa|wi)(\d{2})-/.exec(node.segment);
	return match
		? {
				label: `${{ sp: 'Spring', su: 'Summer', fa: 'Fall', wi: 'Winter' }[match[1]]} 20${match[2]}`,
				order: -(Number(match[2]) * 10 + ['wi', 'sp', 'su', 'fa'].indexOf(match[1]))
			}
		: {
				label: navigation.mode === 'sections' ? 'Documentation' : grouping.fallback,
				order: Infinity
			};
}

export function groupCourses(
	nav: NavNode[],
	navigation: NavigationSettings,
	query = ''
): [string, NavNode[]][] {
	const needle = query.toLowerCase().trim();
	const entries = nav
		.filter((node) => isCourse(node, navigation))
		.map((node) => ({
			node,
			label: courseLabel(node, navigation),
			group: courseGroup(node, navigation)
		}))
		.filter(({ node, label, group }) =>
			`${label} ${group.label} ${node.title}`.toLowerCase().includes(needle)
		);
	entries.sort((a, b) => {
		const groupOrder = a.group.order === b.group.order ? 0 : a.group.order - b.group.order;
		return groupOrder || a.label.localeCompare(b.label, undefined, { numeric: true });
	});
	const groups = new Map<string, NavNode[]>();
	for (const { node, group } of entries)
		groups.set(group.label, [...(groups.get(group.label) ?? []), node]);
	return [...groups];
}
