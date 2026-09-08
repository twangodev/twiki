import { stripObsidianComments } from './lib/comments';
/** Validate Markdown math and render Mermaid with the site's installed engines. */
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { visit } from 'unist-util-visit';
import katex, { type KatexOptions } from 'katex';
import { chromium, type Browser, type Page } from '@playwright/test';

export interface Expression {
	kind: 'math' | 'mermaid';
	value: string;
	line: number;
	column: number;
	display: boolean;
}

export function expressions(markdown: string): Expression[] {
	// Keep original line/column positions while excluding metadata and OFM comments.
	const blank = (s: string) => s.replace(/[^\r\n]/g, ' ');
	const source = stripObsidianComments(
		markdown.replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/, blank),
		true
	);
	const tree = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(source);
	const result: Expression[] = [];
	visit(tree, (node) => {
		if (
			node.type === 'math' ||
			node.type === 'inlineMath' ||
			(node.type === 'code' && node.lang === 'mermaid')
		) {
			result.push({
				kind: node.type === 'code' ? 'mermaid' : 'math',
				value: node.value,
				line: node.position?.start.line ?? 1,
				column: node.position?.start.column ?? 1,
				display: node.type === 'math'
			});
		}
	});
	return result;
}

/** Include tracked and untracked, non-ignored Markdown, descending into submodules. */
export function markdownFiles(inputs: string[]): string[] {
	const files = new Set<string>();
	function collect(input: string) {
		const absolute = path.resolve(input);
		const stat = lstatSync(absolute);
		if (stat.isSymbolicLink()) return;
		if (stat.isFile()) {
			if (!/\.md$/i.test(absolute)) throw new Error(`Expected Markdown: ${input}`);
			files.add(absolute);
			return;
		}
		const names = execFileSync(
			'git',
			['-C', absolute, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
			{ encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
		).split('\0');
		for (const name of new Set(names.filter(Boolean))) {
			const full = path.join(absolute, name);
			if (!existsSync(full)) continue; // tracked deletion in the working tree
			const entry = lstatSync(full);
			if (entry.isDirectory()) {
				if (!existsSync(path.join(full, '.git'))) {
					throw new Error(`Submodule is not initialized: ${full}`);
				}
				collect(full);
			} else if (entry.isFile() && /\.md$/i.test(name)) files.add(full);
		}
	}
	inputs.forEach(collect);
	return [...files].sort();
}

export function checkMath(
	expression: Expression,
	macros: NonNullable<KatexOptions['macros']> = {}
): void {
	katex.renderToString(expression.value, {
		throwOnError: true,
		displayMode: expression.display,
		output: 'html',
		macros,
		strict: 'ignore' // match the site's permissive rendering of supported extensions
	});
}

export async function mermaidPage(browser: Browser): Promise<Page> {
	const page = await browser.newPage();
	// Notes need no network access to render. Keep any diagram links local/inert.
	await page.route('**/*', (route) => route.abort());
	await page.setContent('<!doctype html><html><body></body></html>');
	const entry = import.meta.resolve('mermaid');
	await page.addScriptTag({
		path: path.join(path.dirname(fileURLToPath(entry)), 'mermaid.min.js')
	});
	return page;
}

export async function checkMermaid(page: Page, source: string): Promise<void> {
	await page.evaluate(async (text) => {
		const mermaid = (window as unknown as { mermaid: typeof import('mermaid').default }).mermaid;
		mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'base' });
		await mermaid.parse(text);
		const { svg } = await mermaid.render('validation-diagram', text);
		if (!svg.includes('<svg')) throw new Error('Mermaid produced no SVG');
		document.body.replaceChildren();
	}, source);
}

async function main() {
	const args = process.argv.slice(2);
	if (args.includes('--help')) {
		console.log(
			'Usage: bun run check:diagrams [Markdown files or Git directories...]\nDefaults to all content, including untracked non-ignored notes.'
		);
		return;
	}
	const content = fileURLToPath(new URL('../../content', import.meta.url));
	const files = markdownFiles(args.length ? args : [content]);
	if (!files.length) throw new Error('No Markdown files found');
	let math = 0,
		mermaid = 0,
		failures = 0;
	let browser: Browser | undefined;
	let page: Page | undefined;
	try {
		for (const file of files) {
			const macros: NonNullable<KatexOptions['macros']> = {};
			for (const expression of expressions(readFileSync(file, 'utf8'))) {
				if (expression.kind === 'mermaid' && !browser) {
					// Browser setup failures are infrastructure errors, not errors in every note.
					browser = await chromium.launch();
					page = await mermaidPage(browser);
				}
				try {
					if (expression.kind === 'math') {
						math++;
						checkMath(expression, macros);
					} else {
						mermaid++;
						// Bound pathological diagrams; replace the page after any failure.
						let timer: ReturnType<typeof setTimeout> | undefined;
						try {
							await Promise.race([
								checkMermaid(page!, expression.value),
								new Promise<never>((_, reject) => {
									timer = setTimeout(
										() => reject(new Error('Mermaid render exceeded 15 seconds')),
										15_000
									);
								})
							]);
						} finally {
							clearTimeout(timer);
						}
					}
				} catch (error) {
					failures++;
					const message = error instanceof Error ? error.message : String(error);
					console.error(
						`${path.relative(process.cwd(), file)}:${expression.line}:${expression.column}: ${expression.kind}: ${message.split(/\n\s+at /)[0].replace(/\s+/g, ' ')}`
					);
					if (expression.kind === 'mermaid') {
						await page!.close();
						page = await mermaidPage(browser!);
					}
				}
			}
		}
	} finally {
		await browser?.close();
	}
	console.log(
		`Checked ${files.length} Markdown files: ${math} math expressions, ${mermaid} Mermaid diagrams; ${failures} errors.`
	);
	if (failures) process.exitCode = 1;
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
