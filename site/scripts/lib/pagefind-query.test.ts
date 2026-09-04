import { describe, expect, test } from 'bun:test';
import { parseSearchQuery } from '../../src/lib/components/search/pagefind-query';

describe('parseSearchQuery', () => {
	test('keeps ordinary text searches', () => {
		expect(parseSearchQuery('  distributed systems ')).toEqual({ term: 'distributed systems' });
	});

	test('supports Quartz-style tag-only searches', () => {
		expect(parseSearchQuery('#cs544')).toEqual({ term: null, tag: 'cs544' });
	});

	test('supports text within a tag', () => {
		expect(parseSearchQuery('#cs544   spark sql')).toEqual({ term: 'spark sql', tag: 'cs544' });
	});
});
