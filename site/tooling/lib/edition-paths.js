import path from 'node:path';

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
