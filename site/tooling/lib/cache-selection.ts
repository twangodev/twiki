import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const historyCachePath =
	/^file-history\/[\w-]+\/[a-f0-9]{64}(?:\.json|-blame\.json|-[a-f0-9]{40,64}\.diff)$/;

export const portableCachePath = (file: string) =>
	file.length > 0 &&
	!path.isAbsolute(file) &&
	!/[\\\x00-\x1f\x7f]/.test(file) &&
	file.split('/').every((part) => part !== '' && part !== '.' && part !== '..');

function applicationManifestEntries(value: unknown): unknown {
	const pointer = value as { schema?: number; identity?: string; files?: unknown } | null;
	if (pointer?.schema !== 1 || !/^[a-f0-9]{64}$/.test(pointer.identity ?? '')) return;
	const prefix = `application/${pointer.identity}/`;
	return Array.isArray(pointer.files) &&
		pointer.files.every((file) => typeof file === 'string' && file.startsWith(prefix))
		? pointer.files
		: undefined;
}

/** Archive current entries; historical local generations remain available for undo. */
export function compilerCacheFiles(cache: string) {
	const files: string[] = [];
	const root = realpathSync(cache);
	const regular = (file: string) => {
		try {
			const target = path.join(root, file);
			return lstatSync(target).isFile() && realpathSync(target) === target;
		} catch {
			return false;
		}
	};
	const includeCurrentManifest = (
		name: string,
		pattern: RegExp,
		readEntries = (value: unknown) => value
	) => {
		try {
			if (!regular(name)) throw new Error('Missing cache manifest');
			const manifest = readEntries(JSON.parse(readFileSync(path.join(cache, name), 'utf8')));
			if (
				!Array.isArray(manifest) ||
				!manifest.every(
					(file) => typeof file === 'string' && portableCachePath(file) && pattern.test(file)
				)
			)
				throw new Error('Invalid current cache manifest');
			files.push(name, ...manifest.filter(regular));
		} catch {
			console.log(`No valid ${name}; omitting its entries from cache save`);
		}
	};
	includeCurrentManifest('stage1-current.json', /^stage1\/[a-f0-9]{2}\/[a-f0-9]{64}\.json$/);
	includeCurrentManifest(
		'application-current.json',
		/^application\/[a-f0-9]{64}\//,
		applicationManifestEntries
	);
	for (const edition of ['public', 'full']) {
		includeCurrentManifest(
			`social-titles-current-${edition}.json`,
			/^social-titles\/[a-f0-9]{64}\.png$/
		);
		includeCurrentManifest(
			`content-files-current-${edition}.json`,
			new RegExp(
				`^(?:content-current-${edition}\\.json|content/${edition}/(?:bodies|docs)/[a-f0-9]{64}\\.json)$`
			)
		);
		includeCurrentManifest(
			`search-current-${edition}.json`,
			new RegExp(`^search/${edition}/[a-f0-9]{64}/`)
		);
		includeCurrentManifest(
			`course-files-current-${edition}.json`,
			new RegExp(`^course-files/${edition}/[\\w-]+\\.json$`)
		);
	}
	// A restored runner has no output tree. Prefer the portable manifest emitted
	// after a full build prunes history output; older caches can still use that tree.
	const historyManifest = lstatSync(path.join(cache, 'history-current.json'), {
		throwIfNoEntry: false
	});
	if (historyManifest) includeCurrentManifest('history-current.json', historyCachePath);
	const histories = new Set<string>();
	if (!historyManifest) {
		try {
			for (const entry of readdirSync(path.resolve(cache, '../assets/_files/history'), {
				withFileTypes: true
			}))
				if (entry.isFile()) histories.add(entry.name);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
	}
	const walk = (directory: string, select: (name: string) => boolean) => {
		try {
			if (!lstatSync(path.join(cache, directory)).isDirectory()) return;
			for (const entry of readdirSync(path.join(cache, directory), { withFileTypes: true })) {
				const file = `${directory}/${entry.name}`;
				if (entry.isDirectory()) walk(file, select);
				else if (entry.isFile() && select(entry.name) && regular(file)) files.push(file);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
	};
	walk('file-history', (name) => histories.has(name) || /^revisions-[\w-]+\.jsonl$/.test(name));
	walk('rmd', () => true);
	for (const file of readdirSync(cache))
		if (/^gitdates-v3-[\w-]+\.json$/.test(file) && regular(file)) files.push(file);
	return [...new Set(files)].sort();
}
