import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	constants,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import path from 'node:path';
import { applicationVersion } from './app-version.js';

const schema = 1;
const requiredFiles = [
	'worker.js',
	'svelte-worker.js',
	'prepared-worker/worker.json',
	'application-assets.json'
];
type FileRecord = { path: string; bytes: number; sha256: string };
export type ApplicationIdentity = {
	identity: string;
	applicationVersion: string;
	runtime: {
		node: string;
		bun: string;
		platform: string;
		architecture: string;
		packages: [string, string][];
	};
};
type Manifest = ApplicationIdentity & { schema: number; files: FileRecord[] };
export type CachedApplication = { directory: string; manifest: Manifest };
const copyOptions = { recursive: true, mode: constants.COPYFILE_FICLONE, preserveTimestamps: true };
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const within = (root: string, file: string) => file === root || file.startsWith(root + path.sep);

export function applicationEnvironment(
	environment: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
	const selected: NodeJS.ProcessEnv = {
		...environment,
		NODE_ENV: environment.NODE_ENV ?? 'production',
		VITE_PUBLIC_EDITION: 'false',
		VITE_STATIC_EXPORT: 'false',
		WISCONSIN_SKIP_CONTENT: '1'
	};
	delete selected.WISCONSIN_APPLICATION_VERSION;
	return selected;
}

/** Read-only identity shared by the build producer and encrypted cache transport. */
export function applicationCacheIdentity(
	site: string,
	environment: NodeJS.ProcessEnv = process.env
): ApplicationIdentity {
	const selected = applicationEnvironment(environment);
	const sourceVersion = applicationVersion(site, selected);
	const declared = JSON.parse(readFileSync(path.join(site, 'package.json'), 'utf8'));
	const packages: [string, string][] = Object.keys({
		...declared.dependencies,
		...declared.devDependencies
	})
		.sort()
		.map((name) => {
			try {
				return [
					name,
					JSON.parse(readFileSync(path.join(site, 'node_modules', name, 'package.json'), 'utf8'))
						.version
				];
			} catch {
				return [name, 'missing'];
			}
		});
	const node = spawnSync('node', ['--version'], { encoding: 'utf8', timeout: 5000 });
	const runtime = {
		node: node.status === 0 ? node.stdout.trim() : 'missing',
		bun: process.versions.bun ?? 'missing',
		platform: process.platform,
		architecture: process.arch,
		packages
	};
	const identity = digest(
		JSON.stringify({
			schema,
			applicationVersion: sourceVersion,
			runtime,
			prerenderConcurrency: selected.WISCONSIN_PRERENDER_CONCURRENCY ?? '1'
		})
	);
	return { identity, applicationVersion: sourceVersion, runtime };
}

function inventory(directory: string): FileRecord[] {
	const root = realpathSync(directory);
	const files: FileRecord[] = [];
	function walk(relative: string) {
		for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
			const file = relative ? `${relative}/${entry.name}` : entry.name;
			const absolute = path.join(root, file);
			if (entry.isDirectory()) walk(file);
			else {
				if (!entry.isFile() || realpathSync(absolute) !== absolute)
					throw new Error('Application cache contains a non-regular file');
				const bytes = readFileSync(absolute);
				files.push({ path: file, bytes: bytes.length, sha256: digest(bytes) });
			}
		}
	}
	walk('');
	return files.sort((a, b) => a.path.localeCompare(b.path));
}

function cacheDirectory(site: string, identity: ApplicationIdentity) {
	if (!/^[a-f0-9]{64}$/.test(identity.identity))
		throw new Error('Invalid application cache identity');
	return path.join(site, 'build/generated/cache/application', identity.identity);
}

export function loadApplicationCache(
	site: string,
	identity: ApplicationIdentity
): CachedApplication | undefined {
	const directory = cacheDirectory(site, identity);
	try {
		if (realpathSync(directory) !== path.resolve(directory))
			throw new Error('Redirected application cache');
		const manifest: Manifest = JSON.parse(
			readFileSync(path.join(directory, 'manifest.json'), 'utf8')
		);
		if (
			manifest.schema !== schema ||
			manifest.identity !== identity.identity ||
			manifest.applicationVersion !== identity.applicationVersion ||
			JSON.stringify(manifest.runtime) !== JSON.stringify(identity.runtime) ||
			!Array.isArray(manifest.files)
		)
			return;
		const actual = inventory(path.join(directory, 'kit'));
		if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) return;
		for (const required of requiredFiles)
			if (!actual.some((file) => file.path === required)) return;
		return { directory, manifest };
	} catch {
		return;
	}
}

/** Save a complete neutral prepared app, without any course content or search index. */
export function saveApplicationCache(
	site: string,
	identity: ApplicationIdentity
): CachedApplication {
	const source = path.join(site, 'build/.svelte-kit');
	const files = inventory(source);
	for (const required of requiredFiles)
		if (!files.some((file) => file.path === required))
			throw new Error('Application artifact is incomplete');
	if (
		files.some((file) =>
			/^cloudflare\/(?:_content|_published|pagefind|_files)(?:\/|$)/.test(file.path)
		)
	)
		throw new Error('Application artifact contains generated content');
	const directory = cacheDirectory(site, identity);
	mkdirSync(path.dirname(directory), { recursive: true });
	const transaction = mkdtempSync(path.join(path.dirname(directory), '.application-save-'));
	const staged = path.join(transaction, 'application');
	const backup = path.join(transaction, 'previous');
	let moved = false,
		preserve = false;
	try {
		mkdirSync(staged);
		cpSync(source, path.join(staged, 'kit'), copyOptions);
		const manifest: Manifest = { ...identity, schema, files };
		writeFileSync(path.join(staged, 'manifest.json'), JSON.stringify(manifest));
		if (existsSync(directory)) {
			renameSync(directory, backup);
			moved = true;
		}
		try {
			renameSync(staged, directory);
		} catch (error) {
			if (moved)
				try {
					renameSync(backup, directory);
				} catch (rollback) {
					preserve = true;
					throw new AggregateError(
						[error, rollback],
						'Previous application cache preserved for recovery'
					);
				}
			throw error;
		}
		const pointer = {
			schema,
			identity: identity.identity,
			files: [
				`application/${identity.identity}/manifest.json`,
				...files.map((file) => `application/${identity.identity}/kit/${file.path}`)
			]
		};
		const current = path.join(site, 'build/generated/cache/application-current.json');
		const temporary = path.join(transaction, 'current.json');
		writeFileSync(temporary, JSON.stringify(pointer));
		renameSync(temporary, current);
		return { directory, manifest };
	} finally {
		if (!preserve) rmSync(transaction, { recursive: true, force: true });
	}
}

export function stageApplication(cache: CachedApplication, destination: string) {
	if (existsSync(destination)) throw new Error('Application staging destination already exists');
	cpSync(path.join(cache.directory, 'kit'), destination, copyOptions);
}

/** Prevent generated course assets from becoming inputs to the neutral Vite build. */
export function prepareApplicationStatic(site: string, destination: string) {
	if (existsSync(destination))
		throw new Error('Application static staging destination already exists');
	mkdirSync(destination, { recursive: true });
	let files: string[];
	try {
		files = execFileSync(
			'git',
			['-C', site, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'static'],
			{ encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
		)
			.split('\0')
			.filter(Boolean);
	} catch {
		files = ['static/.gitignore', 'static/favicon.png'];
		const fonts = path.join(site, 'static/fonts');
		if (existsSync(fonts))
			for (const entry of readdirSync(fonts, { recursive: true, withFileTypes: true }))
				if (entry.isFile())
					files.push(path.relative(site, path.join(entry.parentPath, entry.name)));
	}
	const root = realpathSync(site);
	for (const file of files) {
		const source = path.resolve(site, file);
		if (!file.startsWith('static/') || !within(root, source))
			throw new Error('Invalid maintained static path');
		const info = lstatSync(source, { throwIfNoEntry: false });
		if (!info) continue;
		if (!info.isFile() || !within(root, realpathSync(source)))
			throw new Error('Maintained static asset must be an owned regular file');
		const target = path.join(destination, file.slice('static/'.length));
		mkdirSync(path.dirname(target), { recursive: true });
		cpSync(source, target, copyOptions);
	}
}
