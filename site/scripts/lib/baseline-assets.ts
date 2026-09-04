import localOnlyAssets from '../../baseline/local-only-assets.json';

const localOnly = new Set(localOnlyAssets);

export function isLocalOnlyBaselineAsset(file: string, tracked: boolean): boolean {
	return !tracked && localOnly.has(file);
}
