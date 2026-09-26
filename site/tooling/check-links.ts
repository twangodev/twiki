/** Reject deployed-site URLs in notes: internal destinations belong in wikilinks. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import wikiLink from '@flowershow/remark-wiki-link';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import { visit } from 'unist-util-visit';
import { stripObsidianComments } from './lib/comments';
import { markdownFiles } from './lib/markdown-files';

const parser = unified()
	.use(remarkParse)
	.use(remarkGfm)
	.use(wikiLink, {
		urlResolver: ({ filePath, heading }) => filePath + (heading ? `#${heading}` : '')
	})
	.use(remarkRehype, { allowDangerousHtml: true })
	.use(rehypeRaw);

export function directSiteLinks(markdown: string) {
	// Blank metadata and comments without shifting diagnostics in the original file.
	const source = stripObsidianComments(
		markdown.replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/, (s) =>
			s.replace(/[^\r\n]/g, ' ')
		),
		true
	);
	const tree = parser.runSync(parser.parse(source));
	const links: { url: string; line: number; column: number }[] = [];
	visit(tree, 'element', (node) => {
		for (const property of ['href', 'src', 'data', 'poster']) {
			const value = node.properties[property];
			if (typeof value !== 'string' || !/^(?:https?:)?\/\//i.test(value)) continue;
			let url: URL;
			try {
				url = new URL(value, 'https://wisconsin.twango.dev');
			} catch {
				continue;
			}
			if (url.hostname.toLowerCase().replace(/\.$/, '') !== 'wisconsin.twango.dev') continue;
			links.push({
				url: value,
				line: node.position?.start.line ?? 1,
				column: node.position?.start.column ?? 1
			});
		}
	});
	return links;
}

if (import.meta.main) {
	const inputs = process.argv.slice(2);
	const content = fileURLToPath(new URL('../../content', import.meta.url));
	const files = markdownFiles(inputs.length ? inputs : [content], /\.(?:md|rmd)$/i);
	let failures = 0;
	for (const file of files) {
		for (const link of directSiteLinks(readFileSync(file, 'utf8'))) {
			console.error(
				`${path.relative(process.cwd(), file)}:${link.line}:${link.column}: Use an Obsidian wikilink instead of ${link.url}`
			);
			failures++;
		}
	}
	console.log(
		`Checked ${files.length} Markdown/R Markdown files; ${failures} direct same-site links.`
	);
	process.exitCode = failures ? 1 : 0;
}
