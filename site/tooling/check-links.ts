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
import { site } from '../src/lib/config';
import { resolveProject } from './lib/project-config';
import { markdownFiles } from './lib/markdown-files';

const parser = unified()
	.use(remarkParse)
	.use(remarkGfm)
	.use(wikiLink, {
		urlResolver: ({ filePath, heading }) => filePath + (heading ? `#${heading}` : '')
	})
	.use(remarkRehype, { allowDangerousHtml: true })
	.use(rehypeRaw);

export function directSiteLinks(markdown: string, origin = site.url) {
	// Blank metadata and comments without shifting diagnostics in the original file.
	const source = stripObsidianComments(
		markdown.replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/, (s) =>
			s.replace(/[^\r\n]/g, ' ')
		),
		true
	);
	const tree = parser.runSync(parser.parse(source));
	// An HTML comment can exempt the next source line, e.g. a README's site link.
	const ignoredLines = new Set<number>();
	visit(tree, 'comment', (node) => {
		if (node.value.trim() === 'check-links-ignore-next-line' && node.position)
			ignoredLines.add(node.position.end.line + 1);
	});
	const links: { url: string; line: number; column: number }[] = [];
	visit(tree, 'element', (node) => {
		if (node.position && ignoredLines.has(node.position.start.line)) return;
		for (const property of ['href', 'src', 'data', 'poster']) {
			const value = node.properties[property];
			if (typeof value !== 'string' || !/^(?:https?:)?\/\//i.test(value)) continue;
			let url: URL;
			try {
				url = new URL(value, origin);
			} catch {
				continue;
			}
			if (
				url.hostname.toLowerCase().replace(/\.$/, '') !==
				new URL(origin).hostname.toLowerCase().replace(/\.$/, '')
			)
				continue;
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
	const project = resolveProject();
	const content = project.contentDir;
	const files = markdownFiles(inputs.length ? inputs : [content], /\.(?:md|rmd)$/i);
	let failures = 0;
	for (const file of files) {
		for (const link of directSiteLinks(readFileSync(file, 'utf8'), project.site.url)) {
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
