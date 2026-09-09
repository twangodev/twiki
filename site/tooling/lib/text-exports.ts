import { mkdirSync } from 'node:fs';
import { writeChanged } from './output';
import path from 'node:path';
import type { PageDoc } from '../../src/lib/types';
import { site } from '../../src/lib/config';
import { textExportUrl } from '../../src/lib/text-exports';

/** Called separately for each edition; locked outlines never become text exports. */
export function writeTextExports(directory: string, pages: PageDoc[], assets = new Set<string>()) {
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
		if (page.locked || page.markdown === undefined) continue;
		const route = page.slug === 'index' ? '' : page.slug.replace(/\/index$/, '');
		const source = `${site.url}/${route.split('/').map(encodeURIComponent).join('/')}`;
		const text = `# ${page.title}\n\nSource: ${source}\n\n${page.markdown.trim()}\n`;
		for (const format of ['md', 'txt'] as const) {
			const file = path.join(
				directory,
				decodeURIComponent(textExportUrl(page.slug, format)).slice(1)
			);
			if (
				assets.has(path.relative(directory, file)) ||
				written.has(path.relative(directory, file)) ||
				path.relative(directory, file) === 'llms.txt'
			)
				throw new Error(`Text export conflicts with an existing asset: ${page.slug}.${format}`);
			if (Buffer.byteLength(text) > 25 * 1024 * 1024)
				throw new Error(`Text export exceeds deployment size limit: ${page.slug}`);
			mkdirSync(path.dirname(file), { recursive: true });
			writeChanged(file, text);
			written.add(path.relative(directory, file));
		}
		const title = page.title.replace(/[\r\n]/g, ' ').replace(/[\\[\]]/g, '\\$&');
		index.push(`- [${title}](${site.url}${textExportUrl(page.slug)})`);
	}
	if (assets.has('llms.txt')) throw new Error('Text export conflicts with llms.txt');
	writeChanged(path.join(directory, 'llms.txt'), index.join('\n') + '\n');
	written.add('llms.txt');
	return written;
}
