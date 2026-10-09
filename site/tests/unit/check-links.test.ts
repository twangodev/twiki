import { describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { directSiteLinks as detectSiteLinks } from '../../tooling/check-links';
import { markdownFiles } from '../../tooling/lib/markdown-files';

const directSiteLinks = (markdown: string) =>
	detectSiteLinks(markdown, 'https://notes.example.test');
const url = 'https://notes.example.test/fa26-stat324/homework/hw3.Rmd';

describe('internal link validation', () => {
	test('finds Markdown, reference, automatic, image, and HTML destinations', () => {
		for (const source of [
			`[Homework](${url})`,
			`[[${url}|Homework]]`,
			`[Homework][hw]\n\n[hw]: ${url}`,
			`<${url}>`,
			url,
			`![image](${url})`,
			`<a href="${url}">Homework</a>`,
			`<iframe src='${url}'></iframe>`,
			`<div>\n<img src=${url}>\n</div>`
		]) {
			expect(directSiteLinks(source).map((link) => link.url)).toEqual([url]);
		}
	});

	test('recognizes HTTP, protocol-relative, mixed-case hosts, ports, and anchors', () => {
		for (const destination of [
			'http://notes.example.test/note#heading',
			'//notes.example.test/note',
			'https://NOTES.EXAMPLE.TEST:443/note?view=1',
			'https://notes.example.test./note',
			'https://notes.example.test'
		])
			expect(directSiteLinks(`[note](${destination})`)).toHaveLength(1);
	});

	test('ignores external sites, relative links, and normal wikilinks', () => {
		const source = [
			'[[fa26-stat324/homework/hw3.Rmd|Homework]]',
			'![[figure.png]]',
			'[heading](#heading)',
			'[note](./note)',
			'[source](https://example.com/?url=https://notes.example.test)',
			'[different host](https://notes.example.test.example.com/note)'
		].join('\n');
		expect(directSiteLinks(source)).toEqual([]);
	});

	test('excludes metadata, code, and comments while preserving source positions', () => {
		const source = [
			'---',
			`source: ${url}`,
			'---',
			`\`[example](${url})\``,
			'```{r}',
			`# ${url}`,
			'```',
			`%% [hidden](${url}) %%`,
			`<!-- <a href="${url}">hidden</a> -->`,
			`[Homework](${url})`
		].join('\n');
		expect(directSiteLinks(source)).toEqual([{ url, line: 10, column: 1 }]);
	});

	test('an ignore comment exempts only the next source line', () => {
		const source = [
			'<!-- check-links-ignore-next-line -->',
			`[Website](${url})`,
			`[Homework](${url})`
		].join('\n');
		expect(directSiteLinks(source)).toEqual([{ url, line: 3, column: 1 }]);
	});

	test('ignore examples in code and comments do not suppress links', () => {
		for (const example of [
			'`<!-- check-links-ignore-next-line -->`',
			'```html\n<!-- check-links-ignore-next-line -->\n```',
			'%% <!-- check-links-ignore-next-line --> %%',
			'<!-- check-links-ignore-next-line -->\n'
		]) {
			expect(directSiteLinks(`${example}\n[Homework](${url})`)).toHaveLength(1);
		}
	});

	test('scans untracked Rmd files, respects ignores, and fails with actionable diagnostics', () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'check-links-'));
		try {
			execFileSync('git', ['init', '-q', dir]);
			writeFileSync(path.join(dir, '.gitignore'), 'ignored.md\n');
			writeFileSync(path.join(dir, 'ignored.md'), url);
			mkdirSync(path.join(dir, 'homework'));
			const file = path.join(dir, 'homework', 'hw3.Rmd');
			writeFileSync(file, `# Homework\n\n[Homework](${url})\n`);
			expect(markdownFiles([dir, file], /\.(?:md|rmd)$/i)).toEqual([file]);
			const script = path.resolve(import.meta.dir, '../../tooling/check-links.ts');
			writeFileSync(
				path.join(dir, 'twiki.config.json'),
				JSON.stringify({ version: 1, site: { url: 'https://notes.example.test' } })
			);
			const bad = spawnSync(process.execPath, [script, dir], {
				encoding: 'utf8',
				env: { ...process.env, TWIKI_PROJECT_ROOT: dir }
			});
			expect(bad.status).toBe(1);
			expect(bad.stderr).toContain('hw3.Rmd:3:1: Use an Obsidian wikilink');
			writeFileSync(file, '[[hw3.Rmd|Homework]]\n');
			const good = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
			expect(good.status).toBe(0);
			expect(good.stdout).toContain('1 Markdown/R Markdown files; 0 direct same-site links');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
