// Lives under scripts/ (like slug.test.ts) so `bun test scripts` picks it up
// and svelte-check (which only includes src/**) never sees `bun:test`.
import { describe, expect, test } from 'bun:test';
import { cleanResultUrl } from '../../src/lib/components/search/pagefind-url';

describe('cleanResultUrl', () => {
	test('strips .html from flat prerendered pages', () => {
		expect(cleanResultUrl('/sp26-cs537/p2.html')).toBe('/sp26-cs537/p2');
	});

	test('preserves section anchors', () => {
		expect(cleanResultUrl('/sp26-cs537/p2.html#grading')).toBe('/sp26-cs537/p2#grading');
	});

	test('homepage stays root', () => {
		expect(cleanResultUrl('/')).toBe('/');
		expect(cleanResultUrl('/index.html')).toBe('/');
	});

	test('nested index pages collapse to the folder route', () => {
		expect(cleanResultUrl('/sp26-cs537/exams/index.html')).toBe('/sp26-cs537/exams');
	});

	test('keeps README its own page (no ext-strip beyond .html)', () => {
		expect(cleanResultUrl('/sp26-cs537/README.html')).toBe('/sp26-cs537/README');
	});

	test('case-sensitive paths untouched', () => {
		expect(cleanResultUrl('/fa25-anthro105/Notes/Week-1.html#part-2')).toBe(
			'/fa25-anthro105/Notes/Week-1#part-2'
		);
	});
});
