import { readFileSync } from 'node:fs';
import path from 'node:path';
import { restoreDevelopmentCourseFiles } from './course-file-state';
import type { ContentOutputSnapshot } from './dev-state';
import { compiledAssetsDirectory, staticDirectory } from './edition-paths.js';
import { restoreTextExports } from './text-exports';
import { assetExtensions } from './file-policy';
import { restoreCopy } from './output';
import { discoverSourceEntries, type ResolvedProject } from './project-config';
import { getFileExtension, slugifyFilePath, type FilePath } from './slug';
import type { ContentManifest } from '../../src/lib/types';

/** Called within the validated input snapshot, after saved output validation succeeds. */
export function restoreDevelopmentOutputs(
	site: string,
	project: ResolvedProject,
	outputs: ContentOutputSnapshot
) {
	const manifest = JSON.parse(
		readFileSync(path.join(site, 'build/generated/content-manifest.json'), 'utf8')
	) as ContentManifest;
	restoreTextExports(
		staticDirectory(site),
		path.join(site, 'build/generated/pages'),
		Object.values(manifest.pages),
		outputs.files
	);
	restoreDevelopmentCourseFiles(site, project, Object.keys(manifest.pages));
	const assets = new Set<string>(manifest.assets);
	for (const entry of discoverSourceEntries(project)) {
		if (!assetExtensions.has((getFileExtension(entry.relative) ?? '').toLowerCase())) continue;
		const slug = slugifyFilePath(entry.relative as FilePath);
		if (!assets.has(slug)) continue;
		const destination = path.join(compiledAssetsDirectory(site), slug);
		const output = outputs.files.get(destination);
		if (output)
			restoreCopy(path.join(project.contentDir, entry.relative), destination, entry.stat, output);
	}
}
