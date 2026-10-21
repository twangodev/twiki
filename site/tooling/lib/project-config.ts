import { execFileSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
	existsSync,
	lstatSync,
	readFileSync,
	readdirSync,
	realpathSync,
	type BigIntStats
} from 'node:fs';
import path from 'node:path';
import { browsablePath } from './file-policy';
import { writeChanged } from './output';

import {
	projectSchema,
	siteDefaults as defaults,
	type ProjectConfig,
	type SiteMetadata
} from './project-schema';
export type { ProjectConfig, SiteMetadata } from './project-schema';
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
export function parseProjectConfig(value: unknown): ProjectConfig {
	const result = projectSchema.safeParse(value);
	if (!result.success)
		throw new Error(
			'Invalid Twiki config: ' +
				result.error.issues
					.map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
					.join('; ')
		);
	return result.data;
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
			environment.TWIKI_CONTENT_REPO ??
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
		site: {
			...defaults,
			...config.site,
			author: { ...defaults.author, ...config.site?.author },
			navigation: {
				...defaults.navigation,
				...config.site?.navigation,
				grouping: { ...defaults.navigation.grouping, ...config.site?.navigation?.grouping }
			}
		},
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
export interface SourceEntry {
	readonly relative: string;
	readonly stat: Readonly<BigIntStats>;
}

const sourceDiscovery = new AsyncLocalStorage<Map<string, SourceEntry[]>>();

/** One build uses one discovery snapshot; validation before/after it remains fresh. */
export function withSourceDiscovery<T>(
	build: () => T,
	seed?: { project: ResolvedProject; entries: readonly SourceEntry[] }
): T {
	const snapshot = new Map<string, SourceEntry[]>();
	if (seed) snapshot.set(projectIdentity(seed.project), [...seed.entries]);
	return sourceDiscovery.run(snapshot, build);
}

export function discoverSourceFiles(project: ResolvedProject): string[] {
	return discoverSourceEntries(project).map((file) => file.relative);
}

/** File identities belong to the same discovery snapshot as their paths. */
export function discoverSourceEntries(project: ResolvedProject): readonly SourceEntry[] {
	const snapshot = sourceDiscovery.getStore();
	const key = projectIdentity(project);
	let files = snapshot?.get(key);
	if (!files) {
		files = discoverFiles(project);
		snapshot?.set(key, files);
	}
	return [...files];
}

/** Regular, contained inputs only: never follow symlinks or include engine/editor hidden state. */
function discoverFiles(project: ResolvedProject): SourceEntry[] {
	if (!existsSync(project.contentDir)) throw new Error('Content directory does not exist');
	const root = realpathSync(project.contentDir);
	const paths = new Map<string, SourceEntry>();
	const add = (relative: string) => {
		if (paths.has(relative) || !projectSourceVisible(project, relative)) return;
		const file = path.join(project.contentDir, relative);
		try {
			const stat = lstatSync(file, { bigint: true });
			if (stat.isFile() && realpathSync(file) === path.join(root, relative))
				paths.set(relative, { relative, stat });
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
		const rootFiles = tracked(project.contentDir);
		for (const relative of rootFiles) add(relative);
		const recursiveCourses = new Set(
			rootFiles.filter((file) => file.includes('/')).map((file) => file.split('/')[0])
		);
		const courses = declaredContentCourses(project).filter((course) =>
			existsSync(path.join(course.directory, '.git'))
		);
		// Only staged gitlinks can be covered by the parent's recursive listing.
		const indexed = courses.length
			? execFileSync('git', ['-C', project.contentDir, 'ls-files', '-z', '--stage'], {
					maxBuffer: 1 << 28
				})
					.toString()
					.split('\0')
					.filter(Boolean)
			: [];
		const gitlinks = new Set(
			indexed
				.filter((entry) => /^160000 [a-f0-9]+ 0\t/.test(entry))
				.map((entry) => entry.slice(entry.indexOf('\t') + 1))
		);
		const directCourses = new Set(
			indexed
				.map((entry) => entry.slice(entry.indexOf('\t') + 1))
				.filter((file) => file.includes('/'))
				.map((file) => file.split('/')[0])
		);
		for (const course of courses) {
			if (
				gitlinks.has(course.name) &&
				recursiveCourses.has(course.name) &&
				!directCourses.has(course.name)
			)
				continue;
			// Inactive, unindexed, or mixed-index courses still need their own walk.
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
	return [...paths.keys()].sort().map((relative) => paths.get(relative)!);
}

export function projectConfig(repoRoot?: string, environment: NodeJS.ProcessEnv = process.env) {
	return resolveProject(process.cwd(), repoRoot, environment);
}
