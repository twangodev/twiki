import { describe, expect, test } from 'bun:test';
import { localGraphConfig } from '../../src/lib/components/graph/graph-data';

describe('local graph parity', () => {
	test('keeps the repository Quartz depth override', () => {
		expect(localGraphConfig.depth).toBe(2);
	});
});
