import * as pagefind from 'pagefind';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileSearchRecord } from './lib/file-search.js';

/** @param {string} directory */
export async function indexSearch(directory) {
	const start = performance.now();
	try {
		const { index, errors } = await pagefind.createIndex();
		if (!index) throw new Error(errors.join('\n'));
		const indexed = await index.addDirectory({ path: directory });
		if (indexed.errors.length) throw new Error(indexed.errors.join('\n'));
		const entries = JSON.parse(readFileSync('src/lib/generated/file-entries.json', 'utf8'));
		// Bound submissions rather than queueing the whole catalog at once.
		for (let offset = 0; offset < entries.length; offset += 64) {
			const results = await Promise.all(
				entries.slice(offset, offset + 64).map(
					/** @param {{ course: string; file: string }} entry */
					(entry) => index.addCustomRecord(fileSearchRecord(entry))
				)
			);
			for (const result of results)
				if (result.errors.length) throw new Error(result.errors.join('\n'));
		}
		const written = await index.writeFiles({ outputPath: path.join(directory, 'pagefind') });
		if (written.errors.length) throw new Error(written.errors.join('\n'));
		console.log(
			`search: ${indexed.page_count} pages + ${entries.length} file records in ${((performance.now() - start) / 1000).toFixed(2)}s`
		);
	} finally {
		await pagefind.close();
	}
}
