import { expect, test } from 'bun:test';
import { openFile, restoreTabs, tabLabel } from '../../src/lib/file-tabs';

test('previews replace previews without replacing pinned tabs', () => {
	let tabs = openFile([], 'cs300', 'Main.java');
	tabs = openFile(tabs, 'cs300', 'Test.java');
	expect(tabs.map((tab) => tab.path)).toEqual(['Test.java']);
	tabs = openFile(tabs, 'cs300', 'Test.java', true);
	tabs = openFile(tabs, 'cs300', 'Main.java');
	expect(tabs.map((tab) => tab.path)).toEqual(['Test.java', 'Main.java']);
	expect(tabs[0].pinned).toBe(true);
	expect(openFile(tabs, 'cs300', 'Test.java')).toEqual(tabs);
});

test('session restoration is bounded, validated, and never restores file bodies', () => {
	expect(restoreTabs('broken')).toEqual([]);
	expect(restoreTabs('{}')).toEqual([]);
	const tabs = restoreTabs(
		JSON.stringify([
			{
				course: 'cs300',
				path: 'Main.java',
				pinned: true,
				top: 200,
				left: 15,
				body: 'private source'
			},
			{ course: 'cs300', path: 'Main.java' },
			{ course: 42, path: 'bad' },
			{ course: 'cs400', path: 'Main.java', top: -1 }
		])
	);
	expect(tabs).toHaveLength(2);
	expect(tabs[0]).toEqual({ course: 'cs300', path: 'Main.java', pinned: true, top: 200, left: 15 });
	expect(tabs[1].top).toBe(0);
	expect(tabLabel(tabs[0], tabs)).toContain('cs300/');
});
