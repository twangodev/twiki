import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import { toHtml } from 'hast-util-to-html';
import { visit } from 'unist-util-visit';
import { parse } from 'yaml';
import type { Root as HtmlRoot } from 'hast';
import type { Root, RootContent } from 'mdast';
import { fileRoute, type CourseFile } from './files';

export type RmdBlock =
	| { kind: 'markdown'; html: string }
	| {
			kind: 'r';
			code: string;
			label: string;
			evaluate: boolean;
			show: boolean;
	  };

export function relativeFile(path: string, target: string) {
	const parts = path.split('/').slice(0, -1);
	for (const part of target.split('/')) {
		if (part === '..') {
			if (!parts.length) return;
			parts.pop();
		} else if (part && part !== '.') parts.push(part);
	}
	return parts.join('/');
}

// Raw HTML is omitted, and URL schemes are restricted before producing HTML.
export async function parseRmd(source: string, course: string, path: string, files: CourseFile[]) {
	let title = path.split('/').at(-1) ?? 'R Markdown';
	const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (frontmatter) {
		const metadata = parse(frontmatter[1]);
		if (typeof metadata?.title === 'string') title = metadata.title;
		source = source.slice(frontmatter[0].length);
	}
	const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
	const renderer = unified().use(remarkRehype).use(rehypeKatex);
	const tree = parser.parse(source);
	visit(tree, (node) => {
		if (node.type !== 'image' && node.type !== 'link' && node.type !== 'definition') return;
		const normalized = node.url.replace(/[\u0000-\u0020\u007f]/g, '');
		if (/^[a-z][a-z\d+.-]*:/i.test(normalized) && !/^(https?:|mailto:)/i.test(normalized)) {
			node.url = '';
			return;
		}
		if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(normalized)) return;
		const resolved = relativeFile(path, node.url);
		const file = files.find((file) => file.path === resolved);
		if (file)
			node.url =
				node.type === 'image' && !file.locked && file.download
					? file.download
					: fileRoute(course, file.path);
	});
	const blocks: RmdBlock[] = [];
	let prose: RootContent[] = [];
	async function flush() {
		if (!prose.length) return;
		const tree: Root = { type: 'root', children: prose };
		blocks.push({ kind: 'markdown', html: toHtml((await renderer.run(tree)) as HtmlRoot) });
		prose = [];
	}
	for (const node of tree.children) {
		const header = node.type === 'code' ? `${node.lang ?? ''} ${node.meta ?? ''}`.trim() : '';
		if (node.type === 'code' && /^\{r(?:[\s,}]|$)/i.test(header)) {
			await flush();
			const options = header.slice(2).replace(/}\s*$/, '');
			blocks.push({
				kind: 'r',
				code: node.value,
				label:
					options.split(',')[0].trim() ||
					`Chunk ${blocks.filter((b) => b.kind === 'r').length + 1}`,
				evaluate: !/\beval\s*=\s*(FALSE|F)\b/i.test(options),
				show: !/\b(include|echo)\s*=\s*(FALSE|F)\b/i.test(options)
			});
		} else prose.push(node);
	}
	await flush();
	return { title, blocks };
}
