import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
	copyFileSync,
	rmSync
} from 'node:fs';
import path from 'node:path';
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

export async function buildCourseFiles(siteDir: string, noteSlugs: Set<string>) {
	const repo = process.env.WISCONSIN_CONTENT_REPO ?? path.dirname(siteDir);
	const publicEdition = process.env.VITE_PUBLIC_EDITION === 'true';
	const isPublished = publicationFilter(repo);
	const licenseFor = courseLicenseResolver(repo);
	const contentRoot = path.join(repo, 'content');
	const output = path.join(siteDir, '.generated/assets/_files');
	rmSync(output, { recursive: true, force: true });
	for (const dir of ['index', 'blobs']) mkdirSync(path.join(output, dir), { recursive: true });
	const courses = new Map(
		parseGitmodules(path.join(repo, '.gitmodules'))
			.filter((course) => course.path.startsWith('content/'))
			.map((course) => [course.path.slice(8), [] as CourseFile[]])
	);
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
		(publicEdition ? [] : [...courses.keys()]).map((course) => [
			course,
			createFileHistoryBuilder(
				path.join(contentRoot, course),
				output,
				path.join(siteDir, '.generated/cache/file-history', course),
				browsablePath,
				createHash('sha256')
					.update(readFileSync(import.meta.filename))
					.digest('hex')
			)
		])
	);
	for (const tracked of paths) {
		const relative = tracked.slice(8);
		const [course, ...segments] = relative.split('/');
		const files = courses.get(course);
		if (!files || !browsablePath(segments.join('/'))) continue;
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
		if (!existsSync(path.join(output, 'blobs', blob)))
			copyFileSync(source, path.join(output, 'blobs', blob));
		if (suffix === 'pdf') file.kind = 'pdf';
		else if (inlineImages.has(suffix)) file.kind = 'image';
		else if (previewText(bytes)) file.kind = 'text';
		file.history = histories.get(course)?.(file, bytes);
	}
	const entries: { course: string; file: string }[] = [];
	for (const [course, files] of courses) {
		if (publicEdition && !files.length) continue;
		writeFileSync(path.join(output, 'index', `${course}.json`), JSON.stringify(files));
		if (publicEdition) {
			const paths = new Set(['']);
			for (const file of files) {
				const segments = file.path.split('/');
				for (let i = 1; i <= segments.length; i++) paths.add(segments.slice(0, i).join('/'));
			}
			entries.push(...[...paths].map((file) => ({ course, file })));
		}
	}
	mkdirSync(path.join(siteDir, 'src/lib/generated'), { recursive: true });
	writeFileSync(path.join(siteDir, 'src/lib/generated/file-entries.json'), JSON.stringify(entries));
	buildFileIcons(
		siteDir,
		[...courses.values()].flatMap((files) => files.map((file) => file.path))
	);
	console.log(`files: ${count} tracked files across ${courses.size} courses`);
}
