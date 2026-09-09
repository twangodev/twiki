import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	copyFileSync
} from 'node:fs';
import path from 'node:path';
import { writeChanged, pruneOutputs } from './output';
import type { CourseFile } from '../../src/lib/files';
import { parseGitmodules } from './lastmod';
import { slugifyFilePath, type FilePath } from './slug';
import { buildFileIcons } from './file-icons';
import { createFileHistoryBuilder } from './file-history';
import { publicationFilter, courseLicenseResolver } from './publishing';

const excludedDirectories = new Set([
	'node_modules',
	'vendor',
	'build',
	'dist',
	'target',
	'__pycache__'
]);
const excludedNames =
	/^(?:credentials?|secrets?|id_rsa|id_ed25519)(?:[._-]|$)|\.(?:pem|key|p12|pfx|keystore)$/i;
const inlineImages = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']);
export const assetLimit = 25 * 1024 * 1024;

export function browsablePath(file: string) {
	return (
		!file.includes('\\') &&
		!file.split('/').includes('publish.yaml') &&
		!/[\x00-\x1f\x7f]/.test(file) &&
		file
			.split('/')
			.every(
				(segment) =>
					segment.length > 0 &&
					!segment.startsWith('.') &&
					!excludedDirectories.has(segment.toLowerCase()) &&
					!excludedNames.test(segment)
			)
	);
}

export function fileHistoryPolicyKey() {
	return createHash('sha256')
		.update(browsablePath.toString())
		.update(JSON.stringify([...excludedDirectories].sort()))
		.update(excludedNames.source)
		.digest('hex');
}

export function previewText(bytes: Uint8Array): { text: string } | undefined {
	if (Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(0)) return;
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		if (/[\x00-\x08\x0e-\x1f]/.test(text)) return;
		return { text };
	} catch {
		return;
	}
}

type CourseOutput = { files: CourseFile[]; outputs: Set<string>; notes: string };
const previousBuilds = new Map<string, Map<string, CourseOutput>>();

export async function buildCourseFiles(
	siteDir: string,
	noteSlugs: Set<string>,
	changedInputs?: Set<string>,
	development = false
) {
	const repo = process.env.WISCONSIN_CONTENT_REPO ?? path.dirname(siteDir);
	const publicEdition = process.env.VITE_PUBLIC_EDITION === 'true';
	const isPublished = publicationFilter(repo);
	const licenseFor = courseLicenseResolver(repo);
	const contentRoot = path.join(repo, 'content');
	const output = path.join(siteDir, 'build/generated/assets/_files');
	const wanted = new Set<string>();
	for (const dir of ['index', 'blobs']) mkdirSync(path.join(output, dir), { recursive: true });
	const courses = new Map(
		parseGitmodules(path.join(repo, '.gitmodules'))
			.filter((course) => course.path.startsWith('content/'))
			.map((course) => [course.path.slice(8), [] as CourseFile[]])
	);
	const key = JSON.stringify([siteDir, repo, publicEdition, development]);
	const previous = previousBuilds.get(key);
	const active = new Set(courses.keys());
	const outputByCourse = new Map<string, Set<string>>();
	const noteKeys = new Map(
		[...courses.keys()].map((course) => [
			course,
			JSON.stringify([...noteSlugs].filter((slug) => slug.startsWith(course + '/')).sort())
		])
	);
	if (
		previous &&
		changedInputs?.size &&
		[...changedInputs].every((file) => file.startsWith(contentRoot + path.sep))
	) {
		for (const course of courses.keys()) {
			const cached = previous.get(course);
			if (
				!cached ||
				cached.notes !== noteKeys.get(course) ||
				[...changedInputs].some(
					(file) =>
						file === path.join(contentRoot, course) ||
						file.startsWith(path.join(contentRoot, course) + path.sep)
				)
			)
				continue;
			if (![...cached.outputs].every(existsSync)) continue;
			courses.set(course, cached.files);
			outputByCourse.set(course, cached.outputs);
			for (const file of cached.outputs) wanted.add(file);
			active.delete(course);
		}
	}
	for (const course of active) outputByCourse.set(course, new Set());
	const retain = (course: string, file: string) => {
		wanted.add(file);
		outputByCourse.get(course)!.add(file);
	};
	const paths = execFileSync(
		'git',
		['-C', repo, 'ls-files', '-z', '--recurse-submodules', '--', 'content'],
		{ maxBuffer: 1 << 28 }
	)
		.toString()
		.split('\0')
		.filter(Boolean);
	let count = 0;
	const histories = new Map(
		(publicEdition || development ? [] : [...active]).map((course) => [
			course,
			createFileHistoryBuilder(
				path.join(contentRoot, course),
				output,
				path.join(siteDir, 'build/generated/cache/file-history', course),
				browsablePath,
				fileHistoryPolicyKey(),
				(file) => retain(course, file)
			)
		])
	);
	const revisions = new Map(
		(development && !publicEdition ? [...active] : []).map((course) => [
			course,
			execFileSync('git', ['-C', path.join(contentRoot, course), 'rev-parse', 'HEAD'], {
				encoding: 'utf8'
			}).trim()
		])
	);
	for (const tracked of paths) {
		const relative = tracked.slice(8);
		const [course, ...segments] = relative.split('/');
		const files = courses.get(course);
		if (!files || !active.has(course) || !browsablePath(segments.join('/'))) continue;
		const source = path.join(repo, tracked);
		if (!existsSync(source) || !lstatSync(source).isFile()) continue;
		if (realpathSync(source) !== path.join(contentRoot, relative)) continue;
		const size = lstatSync(source).size;
		const file: CourseFile = {
			path: segments.join('/'),
			size,
			kind: 'binary',
			license: licenseFor(relative)
		};
		const extension = path.extname(source).slice(1).toLowerCase();
		const slug = slugifyFilePath(relative as FilePath);
		if (extension === 'md' && noteSlugs.has(slug))
			file.note = '/' + (slug.endsWith('/index') ? slug.slice(0, -6) : slug);
		file.locked =
			publicEdition && (!isPublished(relative) || (extension === 'md' && !noteSlugs.has(slug)));
		files.push(file);
		count++;
		if (file.locked) {
			delete file.license;
			continue;
		}
		if (size > assetLimit) continue;
		const bytes = readFileSync(source);
		const hash = createHash('sha256').update(bytes).digest('hex');
		const suffix = extension === 'pdf' ? 'pdf' : inlineImages.has(extension) ? extension : 'bin';
		const blob = `${hash}.${suffix}`;
		file.download = `/_files/blobs/${blob}`;
		retain(course, path.join(output, 'blobs', blob));
		if (!existsSync(path.join(output, 'blobs', blob)))
			copyFileSync(source, path.join(output, 'blobs', blob));
		if (suffix === 'pdf') file.kind = 'pdf';
		else if (inlineImages.has(suffix)) file.kind = 'image';
		else if (previewText(bytes)) file.kind = 'text';
		file.history =
			development && !publicEdition
				? `/__content/history?course=${encodeURIComponent(course)}&file=${encodeURIComponent(file.path)}&v=${revisions.get(course)}-${hash}`
				: histories.get(course)?.(file, bytes);
	}
	const entries: { course: string; file: string }[] = [];
	for (const [course, files] of courses) {
		if (publicEdition && !files.length) continue;
		retain(course, path.join(output, 'index', `${course}.json`));
		writeChanged(path.join(output, 'index', `${course}.json`), JSON.stringify(files));
		if (publicEdition) {
			const paths = new Set(['']);
			for (const file of files) {
				const segments = file.path.split('/');
				for (let i = 1; i <= segments.length; i++) paths.add(segments.slice(0, i).join('/'));
			}
			entries.push(...[...paths].map((file) => ({ course, file })));
		}
	}
	pruneOutputs(output, wanted, (file) => file === path.join(output, 'icons'));
	mkdirSync(path.join(siteDir, 'src/lib/generated'), { recursive: true });
	writeChanged(path.join(siteDir, 'src/lib/generated/file-entries.json'), JSON.stringify(entries));
	buildFileIcons(
		siteDir,
		[...courses.values()].flatMap((files) => files.map((file) => file.path))
	);
	previousBuilds.set(
		key,
		new Map(
			[...courses].map(([course, files]) => [
				course,
				{ files, outputs: outputByCourse.get(course)!, notes: noteKeys.get(course)! }
			])
		)
	);
	console.log(
		`files: ${count} tracked files across ${active.size} changed courses (${courses.size - active.size} reused)`
	);
}
