import path from 'node:path';

/** Sync only emitted files, keeping course resources in their reserved namespace. */
export function assetSources(
	assetDirectory: string,
	assets: Iterable<string>,
	fileDirectory: string,
	files: Iterable<string>
) {
	const sources: { src: string; rel: string }[] = [];
	for (const relative of new Set(assets)) {
		if (
			path.isAbsolute(relative) ||
			relative.includes('\\') ||
			/[\x00-\x1f\x7f]/.test(relative) ||
			relative.split('/').some((segment) => !segment || segment === '.' || segment === '..')
		)
			throw new Error(`Unsafe compiled asset path: ${relative}`);
		if (relative.startsWith('_files/')) continue;
		sources.push({ src: path.join(assetDirectory, relative), rel: relative });
	}
	for (const source of files) {
		const relative = path.relative(fileDirectory, source);
		if (
			!relative ||
			relative === '..' ||
			relative.startsWith('..' + path.sep) ||
			path.isAbsolute(relative)
		)
			throw new Error(`Course output lies outside its edition: ${source}`);
		sources.push({ src: source, rel: path.join('_files', relative) });
	}
	return sources;
}
