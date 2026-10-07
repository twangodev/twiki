import { execFileSync } from 'node:child_process';
import {
	constants,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import path from 'node:path';
import { compilerCacheFiles, historyCachePath } from './cache-selection';

const copyOptions = {
	recursive: true,
	mode: constants.COPYFILE_FICLONE,
	preserveTimestamps: true,
	verbatimSymlinks: true
};
const parserPath = /^stage1\/[a-f0-9]{2}\/[a-f0-9]{64}\.json$/;
const socialPath = /^social-titles\/[a-f0-9]{64}\.png$/;

function within(root: string, file: string) {
	const relative = path.relative(root, file);
	return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function maintained(file: string) {
	return !(
		/^(?:build|node_modules|\.git|\.svelte-kit|\.wrangler|dist|test-results|playwright-report|tests|docs|benchmarks)(?:\/|$)/.test(
			file
		) ||
		file.startsWith('src/lib/generated/') ||
		/^vite\.config\..*timestamp-/.test(file)
	);
}

/** Git supplies maintained static assets; Git-free fixtures retain the standard hand-placed assets. */
function sourceFiles(site: string) {
	let files: string[];
	try {
		files = execFileSync(
			'git',
			['-C', site, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.'],
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }
		).split('\0');
	} catch {
		files = [];
		const walk = (directory: string) => {
			if (!existsSync(path.join(site, directory))) return;
			for (const entry of readdirSync(path.join(site, directory), { withFileTypes: true })) {
				const file = `${directory}/${entry.name}`;
				if (!maintained(file)) continue;
				if (entry.isDirectory()) walk(file);
				else files.push(file);
			}
		};
		for (const directory of ['src', 'tooling', 'worker', 'assets', 'database', 'migrations'])
			walk(directory);
		for (const entry of readdirSync(site, { withFileTypes: true }))
			if (entry.isFile() && maintained(entry.name) && !entry.name.startsWith('.dev.vars'))
				files.push(entry.name);
		files.push('.dev.vars.example', 'static/.gitignore', 'static/favicon.png');
		walk('static/fonts');
	}
	// Vite loads ignored environment files too. Both editions must see the same bytes.
	for (const entry of readdirSync(site, { withFileTypes: true }))
		if (entry.name.startsWith('.env') && !entry.isDirectory()) files.push(entry.name);
	return [...new Set(files.filter((file) => file && maintained(file)))].sort();
}

function copySource(site: string, destination: string, files: string[]) {
	const root = realpathSync(site);
	for (const file of files) {
		const source = path.resolve(site, file);
		if (!within(path.resolve(site), source)) throw new Error('Invalid site source path');
		const info = lstatSync(source, { throwIfNoEntry: false });
		if (!info) continue; // Tracked files deleted in the working tree are absent from its snapshot.
		if (!within(root, realpathSync(source)) || !statSync(source).isFile())
			throw new Error(`Site source must be an owned regular file: ${file}`);
		const target = path.join(destination, file);
		mkdirSync(path.dirname(target), { recursive: true });
		cpSync(source, target, {
			recursive: true,
			mode: constants.COPYFILE_FICLONE,
			preserveTimestamps: true,
			dereference: true
		});
	}
}

function copyDependencies(site: string, destination: string) {
	const source = path.join(site, 'node_modules');
	if (!existsSync(source)) return;
	const root = realpathSync(source);
	const target = path.join(destination, 'node_modules');
	cpSync(root, target, {
		...copyOptions,
		filter: (file) => !['.vite', '.vite-temp', '.cache'].includes(path.relative(root, file))
	});
	// Keep relative package/bin links, but turn internal absolute links into portable links.
	// External workspace links would silently share source or writable dependency files.
	for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
		if (!entry.isSymbolicLink()) continue;
		const original = path.join(entry.parentPath, entry.name);
		const relative = path.relative(root, original);
		const copied = path.join(target, relative);
		if (!existsSync(copied) && !lstatSync(copied, { throwIfNoEntry: false })) continue;
		const resolved = realpathSync(original);
		if (!within(root, resolved)) throw new Error('Dependency symlink leaves the installed tree');
		if (path.isAbsolute(readlinkSync(original))) {
			rmSync(copied);
			symlinkSync(path.relative(path.dirname(original), resolved), copied);
		}
	}
}

/** Create independent edition trees without touching previous canonical build output. */
export async function createBuildWorkspaces(site: string, contentRepo: string) {
	const started = performance.now();
	site = path.resolve(site);
	const runs = path.join(site, 'build/edition-runs');
	mkdirSync(runs, { recursive: true });
	const directory = mkdtempSync(path.join(runs, 'run-'));
	const publicSite = path.join(directory, 'public/site');
	const fullSite = path.join(directory, 'full/site');
	const cleanup = () => rmSync(directory, { recursive: true, force: true });
	try {
		mkdirSync(fullSite, { recursive: true });
		copySource(site, fullSite, sourceFiles(site));
		copyDependencies(site, fullSite);
		const sourceCache = path.join(site, 'build/generated/cache');
		if (existsSync(sourceCache)) {
			for (const file of compilerCacheFiles(sourceCache)) {
				const target = path.join(fullSite, 'build/generated/cache', file);
				mkdirSync(path.dirname(target), { recursive: true });
				cpSync(path.join(sourceCache, file), target, copyOptions);
			}
		}
		// Clone the captured tree, rather than rereading a potentially changing source inventory.
		// Public course catalogs never build history. Git dates and worksheet caches
		// remain shared inputs; private history is seeded only into the full edition.
		const history = path.join(fullSite, 'build/generated/cache/file-history');
		const historyManifest = path.join(fullSite, 'build/generated/cache/history-current.json');
		cpSync(fullSite, publicSite, {
			...copyOptions,
			filter: (file) => file !== historyManifest && !within(history, file)
		});
		return {
			directory,
			publicSite,
			fullSite,
			contentRepo: path.resolve(contentRepo),
			setupSeconds: (performance.now() - started) / 1000,
			cleanup
		};
	} catch (error) {
		cleanup();
		throw error;
	}
}

function regular(cache: string, file: string) {
	try {
		const root = realpathSync(cache);
		const absolute = path.join(root, file);
		return (
			within(root, absolute) && lstatSync(absolute).isFile() && realpathSync(absolute) === absolute
		);
	} catch {
		return false;
	}
}

function manifest(cache: string, name: string, pattern: RegExp): string[] | undefined {
	try {
		if (!regular(cache, name)) throw new Error('Missing current manifest');
		const files: unknown = JSON.parse(readFileSync(path.join(cache, name), 'utf8'));
		if (
			!Array.isArray(files) ||
			!files.every((file) => typeof file === 'string' && pattern.test(file))
		)
			throw new Error('Invalid current manifest');
		return [...new Set(files.filter((file) => regular(cache, file)))].sort();
	} catch {
		console.log(`No valid ${name}; omitting its entries from merged cache`);
		return undefined;
	}
}

/** Reuse an already disposable full cache; canonical promotion belongs to build assembly. */
function reconcileFullCache(
	cache: string,
	entries: Map<string, string>,
	manifests: Map<string, string[]>
) {
	if (realpathSync(cache) !== cache)
		throw new Error('Disposable cache must not have symlink ancestors');
	const wanted = new Set([...entries.keys(), ...manifests.keys()]);
	const checked = new Set([cache]);
	// A public-only addition must not write through an untrusted seeded directory.
	for (const file of wanted) {
		let directory = path.dirname(path.join(cache, file));
		while (!checked.has(directory)) {
			const info = lstatSync(directory, { throwIfNoEntry: false });
			if (info && (!info.isDirectory() || realpathSync(directory) !== directory))
				throw new Error('Disposable cache entry must have owned directory ancestors');
			checked.add(directory);
			directory = path.dirname(directory);
		}
	}
	const transaction = mkdtempSync(path.join(path.dirname(cache), '.cache-merge-'));
	try {
		const replacements: string[] = [];
		// Prepare every addition before mutating the disposable full cache. Retain
		// existing identical files, including public cards inherited from the seed.
		for (const [file, source] of entries) {
			const target = path.join(cache, file);
			if (
				path.resolve(source) === target ||
				(regular(cache, file) && readFileSync(source).equals(readFileSync(target)))
			)
				continue;
			const staged = path.join(transaction, file);
			mkdirSync(path.dirname(staged), { recursive: true });
			cpSync(source, staged, copyOptions);
			replacements.push(file);
		}
		for (const [name, files] of manifests) {
			writeFileSync(path.join(transaction, name), JSON.stringify(files));
			replacements.push(name);
		}
		for (const file of replacements) {
			const target = path.join(cache, file);
			mkdirSync(path.dirname(target), { recursive: true });
			renameSync(path.join(transaction, file), target);
		}
		const retainedDirectories = new Set<string>();
		for (const file of wanted) {
			let directory = path.posix.dirname(file);
			while (directory !== '.') {
				retainedDirectories.add(directory);
				directory = path.posix.dirname(directory);
			}
		}
		function prune(directory: string) {
			for (const entry of readdirSync(path.join(cache, directory), { withFileTypes: true })) {
				const file = directory ? `${directory}/${entry.name}` : entry.name;
				if (wanted.has(file)) continue;
				if (entry.isDirectory() && retainedDirectories.has(file)) prune(file);
				else rmSync(path.join(cache, file), { recursive: true, force: true });
			}
		}
		prune('');
	} finally {
		rmSync(transaction, { recursive: true, force: true });
	}
}

/** Merge only selected entries into a staged cache; the caller promotes it after both builds pass. */
export function mergeBuildCaches(publicSite: string, fullSite: string, targetCache: string) {
	const publicCache = path.join(publicSite, 'build/generated/cache');
	const fullCache = path.join(fullSite, 'build/generated/cache');
	const entries = new Map<string, string>();
	const manifests = new Map<string, string[]>();
	const add = (cache: string, file: string) => {
		const source = path.join(cache, file);
		const previous = entries.get(file);
		if (previous && previous !== source && !readFileSync(previous).equals(readFileSync(source)))
			throw new Error(`Conflicting immutable build cache entry: ${file}`);
		entries.set(file, source);
	};
	const parsers = [publicCache, fullCache].map((cache) =>
		manifest(cache, 'stage1-current.json', parserPath)
	);
	for (let index = 0; index < parsers.length; index++)
		for (const file of parsers[index] ?? []) add(index === 0 ? publicCache : fullCache, file);
	if (parsers.some((files) => files !== undefined))
		manifests.set(
			'stage1-current.json',
			[...new Set(parsers.flatMap((files) => files ?? []))].sort()
		);
	for (const [edition, cache] of [
		['public', publicCache],
		['full', fullCache]
	] as const) {
		const name = `social-titles-current-${edition}.json`;
		const files = manifest(cache, name, socialPath);
		if (files) {
			manifests.set(name, files);
			for (const file of files) add(cache, file);
		}
	}
	const histories = manifest(fullCache, 'history-current.json', historyCachePath);
	if (histories) manifests.set('history-current.json', histories);
	for (const cache of [publicCache, fullCache]) {
		if (!existsSync(cache)) continue;
		const files = compilerCacheFiles(cache);
		// Full history/revision logs and Git dates are authoritative mutable metadata.
		if (cache === fullCache)
			for (const file of files)
				if (file.startsWith('file-history/') || file.startsWith('gitdates-v3-')) add(cache, file);
		for (const record of files.filter((file) => /^rmd\/[^/]+\/result\.json$/.test(file))) {
			const directory = path.posix.dirname(record);
			let blobs: string[];
			try {
				const saved = JSON.parse(readFileSync(path.join(cache, record), 'utf8'));
				if (
					typeof saved.preview !== 'string' ||
					!Array.isArray(saved.blobs) ||
					!saved.blobs.includes(saved.preview) ||
					!saved.blobs.every(
						(blob: unknown) =>
							typeof blob === 'string' &&
							/^[a-f0-9]{64}\.[a-z]+$/.test(blob) &&
							regular(cache, `${directory}/${blob}`)
					)
				)
					throw new Error('Incomplete R preview cache');
				blobs = saved.blobs;
			} catch {
				continue; // An incomplete worksheet cache safely renders again.
			}
			add(cache, record);
			for (const blob of blobs) add(cache, `${directory}/${blob}`);
		}
	}

	targetCache = path.resolve(targetCache);
	const existing = lstatSync(targetCache, { throwIfNoEntry: false });
	if (existing && !existing.isDirectory())
		throw new Error('Cache merge target must be an owned directory');
	if (existing && targetCache === path.resolve(fullCache)) {
		// This tree is discarded on any error and promoted only after both editions
		// pass. Recopying all of its immutable files adds no canonical protection.
		reconcileFullCache(targetCache, entries, manifests);
		return { files: entries.size + manifests.size };
	}
	mkdirSync(path.dirname(targetCache), { recursive: true });
	const transaction = mkdtempSync(path.join(path.dirname(targetCache), '.cache-merge-'));
	const staged = path.join(transaction, 'cache');
	const previous = path.join(transaction, 'previous');
	let movedPrevious = false;
	let cleanupTransaction = true;
	try {
		mkdirSync(staged);
		for (const [file, source] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
			const target = path.join(staged, file);
			mkdirSync(path.dirname(target), { recursive: true });
			cpSync(source, target, copyOptions);
		}
		for (const [name, files] of manifests)
			writeFileSync(path.join(staged, name), JSON.stringify(files));
		if (existing) {
			renameSync(targetCache, previous);
			movedPrevious = true;
		}
		try {
			renameSync(staged, targetCache);
		} catch (error) {
			if (movedPrevious) {
				try {
					renameSync(previous, targetCache);
				} catch (rollbackError) {
					cleanupTransaction = false;
					throw new AggregateError(
						[error, rollbackError],
						`Cache merge rollback failed; previous cache preserved at ${previous}`
					);
				}
			}
			throw error;
		}
	} finally {
		if (cleanupTransaction) rmSync(transaction, { recursive: true, force: true });
	}
	return { files: entries.size + manifests.size };
}
