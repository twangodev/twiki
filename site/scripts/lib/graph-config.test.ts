import { describe, expect, test } from 'bun:test';
import { globalGraphConfig, localGraphConfig } from '../../src/lib/components/graph/graph-data';

describe('local graph parity', () => {
	test('keeps the repository Quartz depth override', () => {
		expect(localGraphConfig.depth).toBe(2);
	});

	test('anchors the current page in the local preview only', () => {
		expect(localGraphConfig.centerCurrentNode).toBe(true);
		expect(globalGraphConfig.centerCurrentNode).toBe(false);
	});
});
