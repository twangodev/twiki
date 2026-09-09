import { expect, test } from 'bun:test';
import { addNotebookNavigation, isNotebookRoute } from '../../src/lib/notebook-nav';
import type { NavNode } from '../../src/lib/types';

test('notebooks join the notes tree without duplicating folders or including datasets', () => {
	const nav: NavNode[] = [
		{
			segment: 'course',
			title: 'Course',
			children: [
				{
					segment: 'lectures',
					title: 'Lectures',
					route: '/course/lectures',
					children: [
						{
							segment: 'lecture-02',
							title: 'Lecture 02',
							route: '/course/lectures/lecture-02',
							children: []
						}
					]
				}
			]
		}
	];
	const files = [
		{ path: 'lectures/worksheets/lecture-02.Rmd', kind: 'text' as const, size: 10, locked: true },
		{ path: 'lectures/worksheets/Thickness_Data.csv', kind: 'text' as const, size: 10 }
	];
	addNotebookNavigation(nav, 'course', files);
	addNotebookNavigation(nav, 'course', files);
	expect(nav[0].children).toHaveLength(1);
	const worksheets = nav[0].children[0].children.find((n) => n.segment === 'worksheets')!;
	expect(worksheets.children).toHaveLength(1);
	expect(worksheets.children[0]).toMatchObject({
		title: 'Lecture 02 (R worksheet)',
		locked: true,
		route: '/course/files/lectures/worksheets/lecture-02.Rmd'
	});
	expect(isNotebookRoute(nav, worksheets.route!)).toBe(true);
	expect(isNotebookRoute(nav, worksheets.children[0].route!)).toBe(true);
	expect(isNotebookRoute(nav, '/course/files/lectures/worksheets/Thickness_Data.csv')).toBe(false);
});
