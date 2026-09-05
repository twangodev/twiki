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
import { bundledLanguages, createHighlighter } from 'shiki';
import type { BundledLanguage } from 'shiki';
import type { CourseFile, FilePreview } from '../../src/lib/files';
import { parseGitmodules } from './lastmod';
import { slugifyFilePath, type FilePath } from './slug';
import { buildFileIcons } from './file-icons';

const excludedDirectories = new Set([
	'node_modules',
	'vendor',
	'build',
	'dist',
	'target',
	'__pycache__',
	'private',
	'templates'
]);
const excludedNames =
	/^(?:credentials?|secrets?|id_rsa|id_ed25519)(?:[._-]|$)|\.(?:pem|key|p12|pfx|keystore)$/i;
const inlineImages = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']);
export const assetLimit = 25 * 1024 * 1024;
const previewLimit = 256 * 1024;

export function browsablePath(file: string) {
	return (
		!file.includes('\\') &&
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

export function previewText(bytes: Uint8Array): { text: string; truncated: boolean } | undefined {
	const sample = bytes.subarray(0, previewLimit);
	if (sample.some((byte) => byte === 0 || byte < 9 || (byte > 13 && byte < 32))) return;
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(sample, {
			stream: bytes.length > previewLimit
		});
		const lines = text.split('\n');
		return {
			text: lines.slice(0, 2000).join('\n'),
			truncated: bytes.length > previewLimit || lines.length > 2000
		};
	} catch {
		return;
	}
}

function languageFor(file: string): BundledLanguage | 'text' {
	const extension = path.extname(file).slice(1).toLowerCase();
	const aliases: Record<string, string> = {
		h: 'c',
		s: 'asm',
		py: 'python',
		js: 'javascript',
		ts: 'typescript',
		md: 'markdown',
		yml: 'yaml',
		sh: 'bash',
		gradle: 'groovy',
		ipynb: 'json',
		svg: 'xml',
		txt: 'text'
	};
	const language =
		aliases[extension] ??
		{ Makefile: 'make', Dockerfile: 'dockerfile' }[path.basename(file)] ??
		extension;
	return Object.hasOwn(bundledLanguages, language) ? (language as BundledLanguage) : 'text';
}

export async function buildCourseFiles(siteDir: string, noteSlugs: Set<string>) {
	const repo = path.dirname(siteDir);
	const contentRoot = path.join(repo, 'content');
	const output = path.join(siteDir, '.generated/assets/_files');
	const cache = path.join(siteDir, '.generated/cache/file-previews');
	rmSync(output, { recursive: true, force: true });
	for (const dir of ['index', 'blobs', 'previews'])
		mkdirSync(path.join(output, dir), { recursive: true });
	mkdirSync(cache, { recursive: true });
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
	const highlighter = await createHighlighter({
		themes: ['github-light', 'github-dark'],
		langs: []
	});
	let count = 0;
	try {
		for (const tracked of paths) {
			const relative = tracked.slice(8);
			const [course, ...segments] = relative.split('/');
			const files = courses.get(course);
			if (!files || !browsablePath(segments.join('/'))) continue;
			const source = path.join(repo, tracked);
			if (!existsSync(source) || !lstatSync(source).isFile()) continue;
			if (realpathSync(source) !== path.join(contentRoot, relative)) continue;
			const size = lstatSync(source).size;
			const file: CourseFile = { path: segments.join('/'), size, kind: 'binary' };
			files.push(file);
			count++;
			if (size > assetLimit) continue;
			const bytes = readFileSync(source);
			const extension = path.extname(source).slice(1).toLowerCase();
			const hash = createHash('sha256').update(bytes).digest('hex');
			const suffix = extension === 'pdf' ? 'pdf' : inlineImages.has(extension) ? extension : 'bin';
			const blob = `${hash}.${suffix}`;
			file.download = `/_files/blobs/${blob}`;
			if (!existsSync(path.join(output, 'blobs', blob)))
				copyFileSync(source, path.join(output, 'blobs', blob));
			if (suffix === 'pdf') file.kind = 'pdf';
			else if (inlineImages.has(suffix)) file.kind = 'image';
			else {
				const preview = previewText(bytes);
				if (preview) {
					file.kind = 'text';
					const language = languageFor(source);
					const previewName = `${hash}-${language}-1.json`;
					const cached = path.join(cache, previewName);
					if (!existsSync(cached)) {
						if (language !== 'text' && !highlighter.getLoadedLanguages().includes(language))
							await highlighter.loadLanguage(language);
						const rendered: FilePreview = {
							...preview,
							html: highlighter.codeToHtml(preview.text, {
								lang: language,
								themes: { light: 'github-light', dark: 'github-dark' }
							})
						};
						writeFileSync(cached, JSON.stringify(rendered));
					}
					copyFileSync(cached, path.join(output, 'previews', previewName));
					file.preview = `/_files/previews/${previewName}`;
				}
			}
			if (extension === 'md') {
				const slug = slugifyFilePath(relative as FilePath);
				if (noteSlugs.has(slug))
					file.note = '/' + (slug.endsWith('/index') ? slug.slice(0, -6) : slug);
			}
		}
		for (const [course, files] of courses)
			writeFileSync(path.join(output, 'index', `${course}.json`), JSON.stringify(files));
		buildFileIcons(
			siteDir,
			[...courses.values()].flatMap((files) => files.map((file) => file.path))
		);
	} finally {
		highlighter.dispose();
	}
	console.log(`files: ${count} tracked files across ${courses.size} courses`);
}
