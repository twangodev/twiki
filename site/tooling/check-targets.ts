/** Validate local link destinations with Lychee, using the site's wikilink resolution. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import wikiLink from '@flowershow/remark-wiki-link';
import { toHtml } from 'hast-util-to-html';
import { visit } from 'unist-util-visit';
import { markdownFiles } from './lib/markdown-files';
import { stripObsidianComments } from './lib/comments';
import {
	slugifyFilePath,
	simplifySlug,
	stripSlashes,
	transformLink,
	type FilePath
} from './lib/slug';

export function targetRenderer(content: string, files: string[]) {
	const destinations = new Map(
		files.map((file) => [slugifyFilePath(path.relative(content, file) as FilePath), file])
	);
	const allSlugs = [...destinations.keys()];
	return (sourceFile: string, markdown: string) => {
		const sourceSlug = slugifyFilePath(path.relative(content, sourceFile) as FilePath);
		const parser = unified()
			.use(remarkParse)
			.use(remarkGfm)
			.use(remarkMath)
			.use(wikiLink, {
				urlResolver: ({ filePath, heading }) => {
					// Flowershow 3.x includes the escaped table-alias separator's backslash.
					filePath = filePath.replace(/\\$/, '').trim();
					heading = heading.replace(/\\$/, '').trim();
					if (!filePath) return pathToFileURL(sourceFile).href;
					if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(filePath)) return filePath;
					const resolved = transformLink(sourceSlug, filePath, { strategy: 'shortest', allSlugs });
					const url = new URL(
						resolved,
						`https://vault.invalid/${stripSlashes(simplifySlug(sourceSlug), true)}`
					);
					const key = decodeURIComponent(url.pathname.slice(1));
					const target =
						destinations.get(key as typeof sourceSlug) ??
						destinations.get(`${key.replace(/\/$/, '')}/index` as typeof sourceSlug) ??
						path.join(content, key);
					return pathToFileURL(target).href + (heading ? `#${encodeURIComponent(heading)}` : '');
				}
			})
			.use(remarkRehype, { allowDangerousHtml: true })
			.use(rehypeRaw);
		const source = stripObsidianComments(
			markdown.replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/, (s) =>
				s.replace(/[^\r\n]/g, ' ')
			),
			true
		);
		const tree = parser.runSync(parser.parse(source));
		const lines = source.split('\n').map(() => '');
		visit(tree, 'element', (node) => {
			for (const attribute of ['href', 'src', 'poster', 'data']) {
				const value = node.properties[attribute];
				if (typeof value !== 'string' || !value || value.startsWith('#')) continue;
				// Normal Markdown links resolve relative to their source file.
				const url = new URL(value, pathToFileURL(sourceFile));
				if (url.protocol !== 'file:') continue; // deterministic, offline local audit
				const line = (node.position?.start.line ?? 1) - 1;
				lines[line] += toHtml({
					type: 'element',
					tagName: 'a',
					properties: { href: url.href },
					children: []
				});
			}
		});
		return lines.join('\n');
	};
}

if (import.meta.main) {
	const content = fileURLToPath(new URL('../../content', import.meta.url));
	const inputs = process.argv.slice(2);
	const files = markdownFiles([content], /./);
	const sources = inputs.length
		? markdownFiles(inputs, /\.(?:md|rmd)$/i)
		: files.filter((f) => /\.(?:md|rmd)$/i.test(f));
	const render = targetRenderer(content, files);
	const bundled = fileURLToPath(new URL('../build/tools/lychee', import.meta.url));
	const lychee = process.env.LYCHEE ?? (existsSync(bundled) ? bundled : 'lychee');
	const scratch = mkdtempSync(path.join(tmpdir(), 'wisconsin-link-targets-'));
	try {
		const originals = new Map<string, string>();
		for (const [index, source] of sources.entries()) {
			const html = path.join(scratch, `${index}.html`);
			writeFileSync(html, render(source, readFileSync(source, 'utf8')));
			originals.set(html, source);
		}
		const list = path.join(scratch, 'inputs.txt');
		writeFileSync(list, [...originals.keys()].join('\n'));
		const result = spawnSync(lychee, ['--offline', '--format', 'json', '--files-from', list], {
			encoding: 'utf8',
			maxBuffer: 32 * 1024 * 1024
		});
		if (result.error)
			throw new Error(
				'Lychee is required. Install lychee 0.24.2 or set LYCHEE to its executable.',
				{ cause: result.error }
			);
		if (!result.stdout.trim()) throw new Error(result.stderr || `Lychee exited ${result.status}`);
		const report = JSON.parse(result.stdout) as {
			total: number;
			errors: number;
			error_map: Record<
				string,
				{ url: string; span?: { line: number }; status: { text: string } }[]
			>;
		};
		for (const [source, failures] of Object.entries(report.error_map)) {
			for (const failure of failures)
				console.error(
					`${path.relative(process.cwd(), originals.get(source) ?? source)}:${failure.span?.line ?? 1}: ${failure.status.text} (${failure.url})`
				);
		}
		console.log(
			`Lychee checked ${report.total} local links in ${sources.length} Markdown/R Markdown files; ${report.errors} errors.`
		);
		process.exitCode = result.status ?? 1;
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}
