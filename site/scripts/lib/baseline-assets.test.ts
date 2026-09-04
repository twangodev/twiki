import { describe, expect, test } from 'bun:test';
import localOnlyAssets from '../../baseline/local-only-assets.json';
import { isLocalOnlyBaselineAsset } from './baseline-assets';

describe('frozen local-only asset exceptions', () => {
	test('recognizes the same 34 paths without consulting working-tree files', () => {
		expect(localOnlyAssets).toHaveLength(34);
		for (const file of localOnlyAssets) expect(isLocalOnlyBaselineAsset(file, false)).toBe(true);
	});
	test('does not excuse a tracked asset', () => {
		for (const file of localOnlyAssets) expect(isLocalOnlyBaselineAsset(file, true)).toBe(false);
	});
	test('does not exempt other files in ignored directories', () => {
		expect(isLocalOnlyBaselineAsset('sp26-cs537/p6/tests/tests-out/12.out', false)).toBe(false);
		expect(isLocalOnlyBaselineAsset('sp26-cs544/p7/q8.out', false)).toBe(false);
	});
});
