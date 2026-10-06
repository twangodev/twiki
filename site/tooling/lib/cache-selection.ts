import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

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
	const current = (name: string, pattern: RegExp) => {
		try {
			if (!regular(name)) throw new Error('Missing cache manifest');
			const manifest: unknown = JSON.parse(readFileSync(path.join(cache, name), 'utf8'));
			if (
				!Array.isArray(manifest) ||
				!manifest.every((file) => typeof file === 'string' && pattern.test(file))
			)
				throw new Error('Invalid current cache manifest');
			files.push(name, ...manifest.filter(regular));
		} catch {
			console.log(`No valid ${name}; omitting its entries from cache save`);
		}
	};
	current('stage1-current.json', /^stage1\/[a-f0-9]{2}\/[a-f0-9]{64}\.json$/);
	for (const edition of ['public', 'full'])
		current(`social-titles-current-${edition}.json`, /^social-titles\/[a-f0-9]{64}\.png$/);
	// Full-edition history outputs contain every published JSON, blame record and diff.
	// Course output pruning removes obsolete assets before deployment reaches cache save.
	const histories = new Set<string>();
	try {
		for (const entry of readdirSync(path.resolve(cache, '../assets/_files/history'), {
			withFileTypes: true
		}))
			if (entry.isFile()) histories.add(entry.name);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
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
