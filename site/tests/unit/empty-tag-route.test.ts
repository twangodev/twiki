import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { emptyTagRoute } from '../../tooling/lib/empty-tag-route.js';
const fixtures: string[] = [];
function fixture(value?: unknown) {
	const site = mkdtempSync(path.join(tmpdir(), 'twiki-empty-tags-'));
	fixtures.push(site);
	mkdirSync(path.join(site, 'build/generated'), { recursive: true });
	if (value !== undefined)
		writeFileSync(path.join(site, 'build/generated/content-manifest.json'), JSON.stringify(value));
	return site;
}
afterEach(() => {
	for (const site of fixtures.splice(0)) rmSync(site, { recursive: true, force: true });
});
test('a tagless manifest permits only the legitimately empty dynamic tag route', () => {
	const site = fixture({ tags: {} });
	expect(emptyTagRoute(site, ['/tags/[...tag]'])).toBe(true);
	for (const routes of [
		[],
		['/[...slug]'],
		['/[course]/files/[...file]'],
		['/tags/[...tag]', '/unexpected']
	])
		expect(emptyTagRoute(site, routes)).toBe(false);
});
test('missing, malformed, and populated tag indexes retain unseen-route failures', () => {
	for (const value of [
		undefined,
		null,
		{},
		{ tags: null },
		{ tags: [] },
		{ tags: 'empty' },
		{ tags: { math: ['index'] } }
	])
		expect(emptyTagRoute(fixture(value), ['/tags/[...tag]'])).toBe(false);
	const site = fixture({ tags: {} });
	writeFileSync(path.join(site, 'build/generated/content-manifest.json'), 'invalid json');
	expect(emptyTagRoute(site, ['/tags/[...tag]'])).toBe(false);
});
