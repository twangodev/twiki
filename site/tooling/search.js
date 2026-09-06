import * as pagefind from 'pagefind';
import path from 'node:path';

/** @param {string} directory */
export async function indexSearch(directory) {
	const start = performance.now();
	try {
		const { index, errors } = await pagefind.createIndex();
		if (!index) throw new Error(errors.join('\n'));
		const indexed = await index.addDirectory({ path: directory });
		if (indexed.errors.length) throw new Error(indexed.errors.join('\n'));
		const written = await index.writeFiles({ outputPath: path.join(directory, 'pagefind') });
		if (written.errors.length) throw new Error(written.errors.join('\n'));
		console.log(
			`search: ${indexed.page_count} pages in ${((performance.now() - start) / 1000).toFixed(2)}s`
		);
	} finally {
		await pagefind.close();
	}
}
