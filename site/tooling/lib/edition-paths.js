import path from 'node:path';

/** Keep one edition from pruning the other edition's compiled source assets. @param {string} site */
export function compiledAssetsDirectory(site) {
	return path.join(
		site,
		process.env.VITE_PUBLIC_EDITION === 'true'
			? 'build/generated/public-assets'
			: 'build/generated/assets'
	);
}

/** @param {string} site */
export function staticDirectory(site) {
	return path.join(
		site,
		process.env.VITE_PUBLIC_EDITION === 'true' ? 'build/generated/public-static' : 'static'
	);
}

/** @param {string} site */
export function courseFilesDirectory(site) {
	return path.join(
		site,
		process.env.VITE_PUBLIC_EDITION === 'true'
			? 'build/generated/public-files'
			: 'build/generated/assets/_files'
	);
}
