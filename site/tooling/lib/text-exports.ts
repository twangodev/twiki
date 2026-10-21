import { copyChanged, restoreCopy, writeChanged } from './output';
import { readFileSync, type BigIntStats } from 'node:fs';
import path from 'node:path';
import type { ManifestPage, PageDoc } from '../../src/lib/types';
import { site } from '../../src/lib/config';
import { textExportUrl } from '../../src/lib/text-exports';

/** Transform a generated document only when its source or exported output changes. */
function textExportBytes(file: string) {
	const page = JSON.parse(readFileSync(file, 'utf8')) as PageDoc;
	if (page.locked || page.markdown === undefined) return;
	const route = page.slug === 'index' ? '' : page.slug.replace(/\/index$/, '');
	const source = `${site.url}/${route.split('/').map(encodeURIComponent).join('/')}`;
	const text = `# ${page.title}\n\nSource: ${source}\n\n${page.markdown.trim()}\n`;
	if (Buffer.byteLength(text) > 25 * 1024 * 1024)
		throw new Error(`Text export exceeds deployment size limit: ${page.slug}`);
	return Buffer.from(text);
}

function exportFile(directory: string, slug: string, format: 'md' | 'txt') {
	return path.join(directory, decodeURIComponent(textExportUrl(slug, format)).slice(1));
}

/** Seed only identities observed by the validated saved-output snapshot. */
export function restoreTextExports(
	directory: string,
	pageDirectory: string,
	pages: Pick<ManifestPage, 'slug' | 'locked'>[],
	outputs: ReadonlyMap<string, Readonly<BigIntStats>>
) {
	for (const page of pages) {
		if (page.locked) continue;
		const source = path.join(pageDirectory, `${page.slug}.json`);
		const input = outputs.get(source);
		if (!input) continue;
		for (const format of ['md', 'txt'] as const) {
			const file = exportFile(directory, page.slug, format);
			const output = outputs.get(file);
			if (output) restoreCopy(source, file, input, output, textExportBytes);
		}
	}
}

/** Called separately for each edition; locked outlines never become text exports. */
export function writeTextExports(
	directory: string,
	pageDirectory: string,
	pages: Pick<ManifestPage, 'slug' | 'title' | 'locked'>[],
	assets = new Set<string>(),
	development = false
) {
	const written = new Set<string>();
	const index = [
		`# ${site.title}`,
		'',
		`> ${site.description}`,
		'',
		'Notes are available as UTF-8 Markdown (.md) and plain-text Markdown (.txt).',
		'Obsidian wikilinks and LaTeX math are preserved. Restricted notes require site access.',
		'',
		'## Notes',
		''
	];
	for (const page of [...pages].sort((a, b) => a.slug.localeCompare(b.slug))) {
		if (page.locked) continue;
		const destinations: string[] = [];
		for (const format of ['md', 'txt'] as const) {
			const file = exportFile(directory, page.slug, format);
			if (
				assets.has(path.relative(directory, file)) ||
				written.has(path.relative(directory, file)) ||
				path.relative(directory, file) === 'llms.txt'
			)
				throw new Error(`Text export conflicts with an existing asset: ${page.slug}.${format}`);
			destinations.push(file);
			written.add(path.relative(directory, file));
		}
		if (
			copyChanged(
				path.join(pageDirectory, `${page.slug}.json`),
				destinations,
				development,
				textExportBytes
			) === undefined
		)
			throw new Error(`Missing Markdown for text export: ${page.slug}`);
		const title = page.title.replace(/[\r\n]/g, ' ').replace(/[\\[\]]/g, '\\$&');
		index.push(`- [${title}](${site.url}${textExportUrl(page.slug)})`);
	}
	if (assets.has('llms.txt')) throw new Error('Text export conflicts with llms.txt');
	writeChanged(path.join(directory, 'llms.txt'), index.join('\n') + '\n');
	written.add('llms.txt');
	return written;
}
