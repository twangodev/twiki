import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { browsablePath } from './file-policy';
import { writeChanged } from './output';

export interface SiteMetadata {
	name: string;
	title: string;
	url: string;
	description: string;
	author: { name: string; url: string; github: string; email: string };
	locale: string;
	language: string;
}
export interface ProjectConfig {
	version: 1;
	contentDir?: string;
	discovery?: 'filesystem' | 'git';
	publication?: 'private' | 'public' | 'policies';
	site?: Partial<Omit<SiteMetadata, 'author'>> & { author?: Partial<SiteMetadata['author']> };
	cloudflare?: Record<string, unknown>;
	analytics?: { siteId: string; scriptUrl?: string; endpoint?: string };
}
export interface ResolvedProject {
	root: string;
	contentDir: string;
	configFile?: string;
	discovery: 'filesystem' | 'git';
	publication: 'private' | 'public' | 'policies';
	site: SiteMetadata;
	cloudflare?: Record<string, unknown>;
	analytics?: ProjectConfig['analytics'];
}
const defaults: SiteMetadata = {
	name: 'twiki',
	title: 'twiki',
	url: 'http://localhost:5173',
	description: 'Notes, ideas, and reference material.',
	author: { name: '', url: '', github: '', email: '' },
	locale: 'en_US',
	language: 'en'
};
const isObject = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value);
export function parseProjectConfig(value: unknown): ProjectConfig {
	if (!isObject(value) || value.version !== 1)
		throw new Error('Twiki config must be a JSON object with version: 1');
	if (value.contentDir !== undefined && (typeof value.contentDir !== 'string' || !value.contentDir))
		throw new Error('contentDir must be a nonempty path');
	if (
		value.discovery !== undefined &&
		(typeof value.discovery !== 'string' || !['filesystem', 'git'].includes(value.discovery))
	)
		throw new Error('discovery must be filesystem or git');
	if (
		value.publication !== undefined &&
		(typeof value.publication !== 'string' ||
			!['private', 'public', 'policies'].includes(value.publication))
	)
		throw new Error('publication must be private, public or policies');
	if (value.site !== undefined) {
		if (!isObject(value.site)) throw new Error('site must be an object');
		for (const [name, field] of Object.entries(value.site)) {
			if (name === 'author') {
				if (
					!isObject(field) ||
					Object.entries(field).some(
						([key, text]) =>
							!['name', 'url', 'github', 'email'].includes(key) || typeof text !== 'string'
					)
				)
					throw new Error('site.author must contain text fields');
			} else if (
				!['name', 'title', 'url', 'description', 'locale', 'language'].includes(name) ||
				typeof field !== 'string'
			)
				throw new Error(`Unknown or invalid site field: ${name}`);
		}
		if (
			value.site.url !== undefined &&
			!['https:', 'http:'].includes(new URL(String(value.site.url)).protocol)
		)
			throw new Error('site.url must use HTTP or HTTPS');
	}
	if (value.cloudflare !== undefined && !isObject(value.cloudflare))
		throw new Error('cloudflare must be an object');
	if (
		value.analytics !== undefined &&
		(!isObject(value.analytics) ||
			typeof value.analytics.siteId !== 'string' ||
			[value.analytics.scriptUrl, value.analytics.endpoint].some(
				(x) => x !== undefined && typeof x !== 'string'
			))
	)
		throw new Error('analytics must contain a siteId and optional scriptUrl/endpoint');
	return value as unknown as ProjectConfig;
}
/** All writable engine state belongs to siteDir; project/content roots are read-only inputs. */
export function resolveProject(
	siteDir = process.cwd(),
	repoOverride?: string,
	environment: NodeJS.ProcessEnv = process.env
): ResolvedProject {
	const explicit =
		!!environment.TWIKI_PROJECT_ROOT ||
		!!environment.TWIKI_CONFIG_FILE ||
		!!environment.TWIKI_CONTENT_DIR;
	const requestedRoot = path.resolve(
		repoOverride ??
			environment.TWIKI_PROJECT_ROOT ??
			environment.WISCONSIN_CONTENT_REPO ??
			path.dirname(siteDir)
	);
	const root = existsSync(requestedRoot) ? realpathSync(requestedRoot) : requestedRoot;
	const requested = environment.TWIKI_CONFIG_FILE;
	if (requested && !path.isAbsolute(requested))
		throw new Error('TWIKI_CONFIG_FILE must be absolute');
	const configFile =
		requested ??
		(existsSync(path.join(root, 'twiki.config.json'))
			? path.join(root, 'twiki.config.json')
			: undefined);
	const config = configFile
		? parseProjectConfig(JSON.parse(readFileSync(configFile, 'utf8')))
		: { version: 1 as const };
	const selectedContent = path.resolve(
		root,
		environment.TWIKI_CONTENT_DIR ?? config.contentDir ?? (explicit ? '.' : 'content')
	);
	const contentDir = existsSync(selectedContent) ? realpathSync(selectedContent) : selectedContent;
	return {
		root,
		contentDir,
		configFile,
		discovery: config.discovery ?? (explicit ? 'filesystem' : 'git'),
		publication: config.publication ?? (explicit ? 'private' : 'policies'),
		site: { ...defaults, ...config.site, author: { ...defaults.author, ...config.site?.author } },
		cloudflare: config.cloudflare,
		analytics: config.analytics
	};
}
export function writeProjectSiteConfig(siteDir: string, project = resolveProject(siteDir)) {
	writeChanged(
		path.join(siteDir, 'src/lib/site-config.json'),
		JSON.stringify(project.site, null, 2) + '\n'
	);
}
export function projectIdentity(project: ResolvedProject) {
	return JSON.stringify([
		project.root,
		project.contentDir,
		project.discovery,
		project.publication,
		project.site,
		project.cloudflare,
		project.analytics
	]);
}
export function gitRepositoryRoot(directory: string): string | undefined {
	try {
		return execFileSync('git', ['-C', directory, 'rev-parse', '--show-toplevel'], {
			encoding: 'utf8',
			stdio: 'pipe'
		}).trim();
	} catch {
		return;
	}
}
export function gitAvailable(directory: string) {
	return gitRepositoryRoot(directory) !== undefined;
}
export function contentWithinProject(project: ResolvedProject) {
	const relative = path.relative(project.root, project.contentDir);
	return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
export function contentRelative(project: ResolvedProject, file: string) {
	const relative = path.relative(project.contentDir, file).split(path.sep).join('/');
	return relative && relative !== '..' && !relative.startsWith('../') && !path.isAbsolute(relative)
		? relative
		: undefined;
}
export interface ContentCourse {
	name: string;
	directory: string;
}
/** Only explicit submodules are course units; folders in a plain vault remain ordinary folders. */
export function declaredContentCourses(project: ResolvedProject): ContentCourse[] {
	const modules = path.join(project.root, '.gitmodules');
	if (project.discovery !== 'git' || !existsSync(modules)) return [];
	let records: string;
	try {
		records = execFileSync(
			'git',
			['config', '-z', '--file', modules, '--get-regexp', '^submodule\\..*\\.path$'],
			{ encoding: 'utf8', stdio: 'pipe' }
		);
	} catch (error) {
		if ((error as { status?: number }).status === 1) return [];
		throw error;
	}
	const courses: ContentCourse[] = [];
	for (const record of records.split('\0').filter(Boolean)) {
		const directory = path.resolve(project.root, record.slice(record.indexOf('\n') + 1));
		const name = contentRelative(project, directory);
		if (name && !name.includes('/') && /^[\w-]+$/.test(name)) courses.push({ name, directory });
	}
	return courses.sort((a, b) => a.name.localeCompare(b.name));
}
const projectFiles = new Set([
	'twiki.config.json',
	'twiki.config.ts',
	'package.json',
	'bun.lock',
	'bun.lockb',
	'package-lock.json',
	'pnpm-lock.yaml',
	'yarn.lock'
]);
function sourceVisible(relative: string) {
	return (
		browsablePath(relative) ||
		(relative.endsWith('/publish.yaml') &&
			browsablePath(relative.slice(0, -'publish.yaml'.length) + 'publication.yaml')) ||
		relative === 'publish.yaml'
	);
}
export function projectSourceVisible(project: ResolvedProject, relative: string) {
	return (
		sourceVisible(relative) &&
		!(
			path.resolve(project.contentDir) === path.resolve(project.root) && projectFiles.has(relative)
		) &&
		!(
			project.configFile &&
			path.resolve(project.contentDir, relative) === path.resolve(project.configFile)
		)
	);
}
/** Regular, contained inputs only: never follow symlinks or include engine/editor hidden state. */
export function discoverSourceFiles(project: ResolvedProject): string[] {
	if (!existsSync(project.contentDir)) throw new Error('Content directory does not exist');
	const root = realpathSync(project.contentDir);
	const paths = new Set<string>();
	const add = (relative: string) => {
		if (!projectSourceVisible(project, relative)) return;
		const file = path.join(project.contentDir, relative);
		try {
			if (lstatSync(file).isFile() && realpathSync(file) === path.join(root, relative))
				paths.add(relative);
		} catch (error) {
			if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
		}
	};
	if (project.discovery === 'git') {
		if (!gitAvailable(project.contentDir))
			throw new Error('Git discovery requires a Git repository containing the content directory');
		const tracked = (directory: string) =>
			execFileSync('git', ['-C', directory, 'ls-files', '-z', '--recurse-submodules'], {
				maxBuffer: 1 << 28
			})
				.toString()
				.split('\0')
				.filter(Boolean);
		for (const relative of tracked(project.contentDir)) add(relative);
		for (const course of declaredContentCourses(project)) {
			if (!existsSync(path.join(course.directory, '.git'))) continue;
			for (const relative of tracked(course.directory)) add(`${course.name}/${relative}`);
		}
	} else {
		const walk = (directory: string, prefix = '') => {
			for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
				a.name.localeCompare(b.name)
			)) {
				const relative = prefix + entry.name;
				if (!sourceVisible(relative)) continue;
				if (entry.isDirectory()) walk(path.join(directory, entry.name), relative + '/');
				else if (entry.isFile()) add(relative);
			}
		};
		walk(project.contentDir);
	}
	return [...paths].sort();
}

export function projectConfig(repoRoot?: string, environment: NodeJS.ProcessEnv = process.env) {
	return resolveProject(process.cwd(), repoRoot, environment);
}
