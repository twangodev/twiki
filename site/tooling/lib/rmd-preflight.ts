import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import type { CourseFile } from '../../src/lib/files';
import { stageFingerprint } from '../fingerprint';
import { contentGit, declaredCourseDirectories } from './dev-git-state';
import { browsablePath } from './file-policy';
import { publicationFilter } from './publishing';
import { lockedRRuntime, readRRenderProfile } from './r-runtime';
import { readRmdPreviewResult, rmdCourseInputs } from './rmd-preview-cache';
import { slugifyFilePath, type FilePath } from './slug';

export interface RmdPreflight {
	schemaVersion: 1;
	requiresR: boolean;
	worksheets: number;
	verified: number;
	reason: 'unused' | 'verified' | 'profile-or-fonts' | 'missing-or-stale' | 'invalid-inputs';
	runtimeSha256?: string;
}

/** Reconstruct the renderer's broad, indexed course closure without executing R or a worksheet. */
export async function preflightRmdPreviews(
	site: string,
	repo: string,
	environment: NodeJS.ProcessEnv = process.env
): Promise<RmdPreflight> {
	let worksheets = 0,
		verified = 0;
	try {
		const courses = new Set(
			declaredCourseDirectories(repo).map((course) =>
				path.relative(path.join(repo, 'content'), course)
			)
		);
		const sources = new Map<string, { relative: string; source: string }[]>();
		const paths = contentGit('-C', repo, 'ls-files', '-z', '--recurse-submodules', '--', 'content')
			.toString()
			.split('\0')
			.filter(Boolean);
		for (const tracked of paths) {
			const [course, ...segments] = tracked.slice(8).split('/');
			const relative = segments.join('/');
			if (!courses.has(course) || !browsablePath(relative)) continue;
			const source = path.resolve(repo, tracked);
			const info = lstatSync(source, { throwIfNoEntry: false });
			if (!info?.isFile() || realpathSync(source) !== source) continue;
			const files = sources.get(course) ?? [];
			files.push({ relative, source });
			sources.set(course, files);
		}
		const worksheetCourses = [...sources].filter(([, files]) =>
			files.some((file) => /\.rmd$/i.test(file.relative))
		);
		if (!worksheetCourses.length)
			return { schemaVersion: 1, requiresR: false, worksheets: 0, verified: 0, reason: 'unused' };
		const published = publicationFilter(repo);
		const editions: { course: string; files: CourseFile[] }[] = [];
		for (const [course, sources] of worksheetCourses) {
			const noteSlugs = new Set<string>();
			// Match the compiler's whole non-draft catalog, including locked notes.
			for (const tracked of paths) {
				if (
					!tracked.startsWith(`content/${course}/`) ||
					path.extname(tracked).toLowerCase() !== '.md' ||
					tracked.split('/').some((segment) => segment.startsWith('.'))
				)
					continue;
				const source = path.resolve(repo, tracked);
				const info = lstatSync(source, { throwIfNoEntry: false });
				if (!info?.isFile() || realpathSync(source) !== source) continue;
				if (info.size > 25 * 1024 * 1024) throw new Error('Uncertain oversized note catalog');
				const { data } = matter(readFileSync(source, 'utf8'), {
					engines: { yaml: (value) => yaml.load(value, { schema: yaml.JSON_SCHEMA }) as object }
				});
				if (data.draft !== true && data.draft !== 'true')
					noteSlugs.add(slugifyFilePath(tracked.slice(8) as FilePath));
			}
			const full: CourseFile[] = [],
				publicFiles: CourseFile[] = [];
			for (const { relative, source } of sources) {
				const size = lstatSync(source).size;
				const bytes = size <= 25 * 1024 * 1024 ? readFileSync(source) : undefined;
				const hash = bytes && createHash('sha256').update(bytes).digest('hex');
				const extension = path.extname(source).slice(1).toLowerCase();
				const suffix =
					extension === 'pdf'
						? 'pdf'
						: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(extension)
							? extension
							: 'bin';
				const file: CourseFile = {
					path: relative,
					size,
					kind:
						bytes && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(extension)
							? 'image'
							: 'binary',
					download: hash ? `/_files/blobs/${hash}.${suffix}` : undefined
				};
				const slug = slugifyFilePath(`${course}/${relative}` as FilePath);
				if (extension === 'md' && noteSlugs.has(slug))
					file.note = '/' + (slug.endsWith('/index') ? slug.slice(0, -6) : slug);
				full.push(file);
				const locked =
					!published(`${course}/${relative}`) || (extension === 'md' && !noteSlugs.has(slug));
				publicFiles.push(
					locked ? { ...file, kind: 'binary', locked: true, download: undefined } : { ...file }
				);
			}
			for (const files of [publicFiles, full]) {
				worksheets += files.filter(
					(file) => !file.locked && file.download && /\.rmd$/i.test(file.path)
				).length;
				editions.push({ course, files });
			}
		}
		if (!worksheets)
			return { schemaVersion: 1, requiresR: false, worksheets: 0, verified: 0, reason: 'unused' };
		let runtime: string;
		try {
			runtime = lockedRRuntime(site, environment);
		} catch {
			return {
				schemaVersion: 1,
				requiresR: true,
				worksheets,
				verified,
				reason: 'profile-or-fonts'
			};
		}
		const policy = await stageFingerprint('rmd');
		for (const { course, files } of editions) {
			const inputs = rmdCourseInputs(files);
			for (const worksheet of files.filter(
				(file) => !file.locked && file.download && /\.rmd$/i.test(file.path)
			)) {
				if (
					!readRmdPreviewResult(site, {
						runtime,
						policy,
						course,
						inputs,
						worksheet: worksheet.path
					})
				)
					return {
						schemaVersion: 1,
						requiresR: true,
						worksheets,
						verified,
						reason: 'missing-or-stale'
					};
				verified++;
			}
		}
		return {
			schemaVersion: 1,
			requiresR: false,
			worksheets,
			verified,
			reason: 'verified',
			runtimeSha256: readRRenderProfile(site, environment)!.runtimeSha256
		};
	} catch {
		return { schemaVersion: 1, requiresR: true, worksheets, verified, reason: 'invalid-inputs' };
	}
}
