import * as pagefind from 'pagefind';
import path from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fileSearchRecord } from './lib/file-search.js';
import { searchHtmlInputs } from './lib/search-inputs.js';
import {
	restoreSearchCache,
	saveSearchCache,
	searchInputKey,
	selectSearchCache
} from './lib/search-cache.js';

/** @param {string} directory */
export async function indexSearch(directory) {
	const start = performance.now();
	const manifest = JSON.parse(readFileSync('build/generated/content-manifest.json', 'utf8'));
	const html = searchHtmlInputs(manifest, (slug) =>
		JSON.parse(readFileSync(path.join('build/generated/pages', `${slug}.json`), 'utf8'))
	);
	const entries = JSON.parse(readFileSync('src/lib/generated/file-entries.json', 'utf8'));
	const records = entries.map(fileSearchRecord);
	const edition = process.env.VITE_PUBLIC_EDITION === 'true' ? 'public' : 'full';
	const pagefindVersion = JSON.parse(
		readFileSync(
			path.resolve(path.dirname(fileURLToPath(import.meta.resolve('pagefind'))), '../package.json'),
			'utf8'
		)
	).version;
	const key = searchInputKey({ html, records, pagefindVersion, edition });
	const cacheRoot = path.resolve('build/generated/cache');
	const cache = path.join(cacheRoot, 'search', edition, key);
	const output = path.join(directory, 'pagefind');
	if (restoreSearchCache(cache, output, key, edition)) {
		const saved = JSON.parse(readFileSync(path.join(cache, 'manifest.json'), 'utf8'));
		selectSearchCache(cacheRoot, edition, [
			`search/${edition}/${key}/manifest.json`,
			...saved.files.map(
				/** @param {{path: string}} file */ (file) => `search/${edition}/${key}/files/${file.path}`
			)
		]);
		console.log(
			`search: ${html.length} pages + ${entries.length} file records in ${((performance.now() - start) / 1000).toFixed(2)}s (complete index cached)`
		);
		return;
	}
	try {
		const { index, errors } = await pagefind.createIndex();
		if (!index) throw new Error(errors.join('\n'));
		for (let offset = 0; offset < html.length; offset += 64) {
			const results = await Promise.all(
				html.slice(offset, offset + 64).map((input) => index.addHTMLFile(input))
			);
			for (const result of results)
				if (result.errors.length) throw new Error(result.errors.join('\n'));
		}
		// Bound submissions rather than queueing the whole catalog at once.
		for (let offset = 0; offset < records.length; offset += 64) {
			const results = await Promise.all(
				records
					.slice(offset, offset + 64)
					.map(
						/** @param {import('pagefind').CustomRecord} record */ (record) =>
							index.addCustomRecord(record)
					)
			);
			for (const result of results)
				if (result.errors.length) throw new Error(result.errors.join('\n'));
		}
		// The index owns this directory; remove old generations on a cache miss.
		rmSync(output, { recursive: true, force: true });
		const written = await index.writeFiles({ outputPath: output });
		if (written.errors.length) throw new Error(written.errors.join('\n'));
		try {
			selectSearchCache(cacheRoot, edition, saveSearchCache(cacheRoot, output, key, edition));
		} catch {
			selectSearchCache(cacheRoot, edition, []);
			console.log(
				'search: complete index cache could not be saved; generated index remains available'
			);
		}
		console.log(
			`search: ${html.length} pages + ${entries.length} file records in ${((performance.now() - start) / 1000).toFixed(2)}s`
		);
	} finally {
		await pagefind.close();
	}
}

// The build orchestrator runs this in the same Node runtime as Vite's adapter.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (!process.argv[2]) throw new Error('Expected Pagefind output directory');
	await indexSearch(process.argv[2]);
}
