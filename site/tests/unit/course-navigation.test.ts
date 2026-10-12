import { describe, expect, test } from 'bun:test';
import { navigationSchema, projectSchema } from '../../tooling/lib/project-schema';
import { courseGroup, courseLabel, groupCourses, isCourse } from '../../src/lib/course-navigation';
import type { NavNode } from '../../src/lib/types';

function course(segment: string, title = segment): NavNode {
	return {
		segment,
		title,
		route: '/' + segment,
		children: [{ segment: 'index', title: 'Overview', route: '/' + segment, children: [] }]
	};
}

describe('course navigation grouping', () => {
	test('Wisconsin semester defaults keep labels and newest-first ordering', () => {
		const navigation = navigationSchema.parse({});
		const fall = course('fa26-cs759');
		expect(courseLabel(fall, navigation)).toBe('CS 759');
		expect(courseGroup(fall, navigation).label).toBe('Fall 2026');
		expect(
			groupCourses(
				[course('misc'), course('sp26-cs537'), fall, course('wi26-cs400')],
				navigation
			).map(([label]) => label)
		).toEqual(['Fall 2026', 'Spring 2026', 'Winter 2026', 'Other']);
	});

	test('explicit course membership and patterns produce ordered school-year groups', () => {
		const navigation = navigationSchema.parse({
			grouping: {
				mode: 'patterns',
				fallback: 'Unassigned',
				groups: [
					{ label: 'Senior Year', courses: ['AP-Calculus-BC', 'Biology-1'] },
					{ label: 'Junior Year', match: '^AP-Calculus-' },
					{ label: 'Grade 7', match: '-7$' }
				]
			}
		});
		const senior = course('AP-Calculus-BC', 'AP Calculus BC');
		const nav = [
			course('AP-Calculus-AB', 'AP Calculus AB'),
			course('Biology-7'),
			senior,
			course('Unknown')
		];
		expect(courseLabel(senior, navigation)).toBe('AP Calculus BC');
		expect(groupCourses(nav, navigation).map(([label]) => label)).toEqual([
			'Senior Year',
			'Junior Year',
			'Grade 7',
			'Unassigned'
		]);
		expect(groupCourses(nav, navigation).flatMap(([, courses]) => courses)).toHaveLength(4);
		expect(senior.route).toBe('/AP-Calculus-BC');
	});

	test('overview-only courses appear in their configured year without changing their route', () => {
		const navigation = navigationSchema.parse({
			grouping: { mode: 'patterns', groups: [{ label: 'Grade 8', courses: ['Geometry'] }] }
		});
		const leaf: NavNode = {
			title: 'Geometry',
			segment: 'Geometry',
			route: '/Geometry',
			children: []
		};
		expect(isCourse(leaf, navigation)).toBe(true);
		expect(isCourse(leaf, navigationSchema.parse({}))).toBe(false);
		expect(groupCourses([leaf], navigation)).toEqual([['Grade 8', [leaf]]]);
		expect(courseLabel(course('AP-Calculus-BC'), navigation)).toBe('AP Calculus BC');
	});

	test('search matches year headings as well as course titles and omits empty groups', () => {
		const navigation = navigationSchema.parse({
			grouping: {
				mode: 'patterns',
				groups: [
					{ label: 'Senior Year', courses: ['Biology-1'] },
					{ label: 'Junior Year', courses: ['AP-Statistics'] }
				]
			}
		});
		const nav = [course('Biology-1', 'Biology'), course('AP-Statistics', 'AP Statistics')];
		expect(groupCourses(nav, navigation, 'senior').map(([label]) => label)).toEqual([
			'Senior Year'
		]);
		expect(groupCourses(nav, navigation, 'statistics')[0][0]).toBe('Junior Year');
		expect(groupCourses(nav, navigation, 'no-match')).toEqual([]);
	});

	test('flat navigation keeps readable titles and natural alphabetical order', () => {
		const navigation = navigationSchema.parse({ grouping: { mode: 'none' } });
		expect(groupCourses([course('b', 'Course 10'), course('a', 'Course 2')], navigation)).toEqual([
			['', [course('a', 'Course 2'), course('b', 'Course 10')]]
		]);
	});

	test('sections preserve documentation labels without changing semester compatibility', () => {
		const navigation = navigationSchema.parse({ mode: 'sections' });
		expect(courseLabel(course('guides', 'Guides'), navigation)).toBe('Guides');
		expect(courseGroup(course('guides'), navigation).label).toBe('Documentation');
	});

	test('invalid regular expressions and matcherless groups fail configuration validation', () => {
		for (const group of [
			{ label: 'Year', match: '[' },
			{ label: 'Year' },
			{ label: 'Year', courses: [] }
		]) {
			expect(() =>
				projectSchema.parse({
					version: 1,
					site: {
						navigation: {
							grouping: {
								mode: 'patterns',
								groups: [group]
							}
						}
					}
				})
			).toThrow();
		}
	});
});
