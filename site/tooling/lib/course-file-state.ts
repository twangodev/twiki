import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { CourseFile } from '../../src/lib/files';
import { courseFilesDirectory } from './edition-paths.js';
import { projectIdentity, type ResolvedProject } from './project-config';
import { browsablePath } from './file-policy';

export type CourseOutput = { files: CourseFile[]; outputs: Set<string>; notes: string };
const builds = new Map<string, Map<string, CourseOutput>>();

export function courseFileState(
	site: string,
	project: ResolvedProject,
	publicEdition: boolean,
	development: boolean
) {
	const key = JSON.stringify([site, projectIdentity(project), publicEdition, development]);
	return {
		get: () => builds.get(key),
		set: (outputs: Map<string, CourseOutput>) => builds.set(key, outputs)
	};
}

export function courseNoteKey(course: string, slugs: Iterable<string>) {
	return JSON.stringify([...slugs].filter((slug) => slug.startsWith(course + '/')).sort());
}

/** Restore only after the pipeline validates saved development inputs AND outputs. */
export function restoreDevelopmentCourseFiles(site: string, project: ResolvedProject) {
	const publicEdition = process.env.VITE_PUBLIC_EDITION === 'true';
	const output = courseFilesDirectory(site);
	const directory = path.join(output, 'index');
	const restored = new Map<string, CourseOutput>();
	if (!existsSync(directory)) return;
	const manifest = JSON.parse(
		readFileSync(path.join(site, 'build/generated/content-manifest.json'), 'utf8')
	);
	const slugs = Object.keys(manifest.pages);
	for (const name of readdirSync(directory)) {
		if (!name.endsWith('.json')) continue;
		const course = name.slice(0, -5);
		if (!browsablePath(course) || course.includes('/')) continue;
		const index = path.join(directory, name);
		try {
			const files: CourseFile[] = JSON.parse(readFileSync(index, 'utf8'));
			const outputs = new Set([index]);
			if (
				!Array.isArray(files) ||
				!files.every((file) => {
					if (!file || typeof file.path !== 'string' || !browsablePath(file.path)) return false;
					if (!file.download) return true;
					if (
						!/^\/_files\/blobs\/[a-f0-9]{64}\.(?:bin|pdf|png|jpg|jpeg|gif|webp|avif)$/.test(
							file.download
						)
					)
						return false;
					outputs.add(path.join(output, 'blobs', path.basename(file.download)));
					return true;
				})
			)
				continue;
			restored.set(course, { files, outputs, notes: courseNoteKey(course, slugs) });
		} catch {
			// An incomplete course can be rebuilt normally without discarding other courses.
		}
	}
	courseFileState(site, project, publicEdition, true).set(restored);
}
