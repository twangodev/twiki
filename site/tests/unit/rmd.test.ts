import { expect, test } from 'bun:test';
import { parseRmd, relativeFile } from '../../src/lib/rmd';

test('PDF layout commands are hidden only in standalone prose', async () => {
	const source =
		String.raw`Before

\vspace{1cm}

\vspace*{2em}

\newpage

\pagebreak[4]

\pagebreak

After

Use \vspace{1cm} for spacing.

\unknown{1cm}

` + '`\\newpage`\n\n```tex\n\\vspace{1cm}\n```\n\n```{r}\n# \\pagebreak\n```';
	const result = await parseRmd(source, 'course', 'hw2.Rmd', []);
	const html = result.blocks
		.filter((block) => block.kind === 'markdown')
		.map((block) => block.html)
		.join('');
	expect(html).toContain('<p>Before</p>\n<p>After</p>');
	expect(html).toContain('Use \\vspace{1cm} for spacing.');
	expect(html).toContain('\\unknown{1cm}');
	expect(html).toContain('<code>\\newpage</code>');
	expect(html).toContain('<code class="language-tex">\\vspace{1cm}\n</code>');
	expect(html).not.toContain('\\vspace*');
	expect(html).not.toContain('<p>\\pagebreak');
	expect(result.blocks.at(-1)).toMatchObject({ kind: 'r', code: '# \\pagebreak' });
});

test('Rmd separates executable chunks, preserves code fences, and respects opt-out options', async () => {
	const result = await parseRmd(
		'---\ntitle: Example\n---\n# Notes\n\n```{r setup, include=FALSE}\nx <- 2\n```\n\n```{r, eval=FALSE}\nx + 1\n```\n\n```python\nprint(2)\n```',
		'course',
		'notes/test.Rmd',
		[]
	);
	expect(result.title).toBe('Example');
	const chunks = result.blocks.filter((b) => b.kind === 'r');
	expect(chunks).toEqual([
		{ kind: 'r', code: 'x <- 2', label: 'setup', evaluate: true, show: false },
		{ kind: 'r', code: 'x + 1', label: 'Chunk 2', evaluate: false, show: true }
	]);
	expect(result.blocks.at(-1)).toMatchObject({
		kind: 'markdown',
		html: expect.stringContaining('language-python')
	});
});

test('prose renders math safely and resolves authorized course images', async () => {
	const result = await parseRmd(
		'![plot](assets/p.png)\n\n$x^2$\n\n<script>alert(1)</script>\n\n[bad](javascript:alert%281%29)',
		'course',
		'notes/test.Rmd',
		[{ path: 'notes/assets/p.png', size: 20, kind: 'image', download: '/_files/blob/plot' }]
	);
	const html = result.blocks
		.filter((b) => b.kind === 'markdown')
		.map((b) => b.html)
		.join('');
	expect(html).toContain('/_files/blob/plot');
	expect(html).toContain('katex');
	expect(html).not.toContain('<script');
	expect(html).not.toContain('javascript:');
	expect(relativeFile('notes/a.Rmd', '../data.csv')).toBe('data.csv');
	expect(relativeFile('a.Rmd', '../secret')).toBeUndefined();
});

test('Rmd wikilinks resolve notes and worksheet files without changing code or math', async () => {
	const source = [
		'[[course/lectures/lecture-01#Sampling Methods|Lecture 1]]',
		'[[hw2.Rmd|Homework 2]]',
		'[[course/homework/flush.csv|Data]]',
		'`[[hw2.Rmd]]`',
		'```{r}\nx <- "[[hw2.Rmd]]"\n```',
		'[[javascript:alert(1)|bad]]'
	].join('\n\n');
	const result = await parseRmd(source, 'course', 'homework/hw1.Rmd', [
		{ path: 'lectures/lecture-01.md', note: 'course/lectures/lecture-01', kind: 'text', size: 1 },
		{ path: 'homework/hw2.Rmd', kind: 'text', size: 1 },
		{ path: 'homework/flush.csv', kind: 'text', size: 1, locked: true }
	]);
	const html = result.blocks
		.filter((b) => b.kind === 'markdown')
		.map((b) => b.html)
		.join('');
	expect(html).toContain('href="/course/lectures/lecture-01#sampling-methods">Lecture 1</a>');
	expect(html).toContain('href="/course/files/homework/hw2.Rmd">Homework 2</a>');
	expect(html).toContain('href="/course/files/homework/flush.csv">Data</a>');
	expect(html).toContain('<code>[[hw2.Rmd]]</code>');
	expect(html).not.toContain('href="javascript:');
	expect(result.blocks.find((b) => b.kind === 'r')).toMatchObject({ code: 'x <- "[[hw2.Rmd]]"' });
});

test('Flowershow parses heading-only links and escaped table aliases; private embeds stay links', async () => {
	const result = await parseRmd(
		[
			'[[#Sampling Methods|Jump]]',
			'',
			'| Link |',
			'| --- |',
			'| [[course/lectures/lecture-01\\|Lecture 1]] |',
			'',
			'![[assets/allowed.png]]',
			'![[assets/private.png]]',
			'![[javascript:alert(1)]]'
		].join('\n'),
		'course',
		'homework/hw1.Rmd',
		[
			{ path: 'lectures/lecture-01.md', note: 'course/lectures/lecture-01', kind: 'text', size: 1 },
			{
				path: 'homework/assets/allowed.png',
				kind: 'image',
				size: 1,
				download: '/_files/allowed.png'
			},
			{
				path: 'homework/assets/private.png',
				kind: 'image',
				size: 1,
				locked: true,
				download: '/_files/private.png'
			}
		]
	);
	const html = result.blocks
		.filter((b) => b.kind === 'markdown')
		.map((b) => b.html)
		.join('');
	expect(html).toContain('href="#sampling-methods">Jump</a>');
	expect(html).toContain('href="/course/lectures/lecture-01">Lecture 1</a>');
	expect(html).toContain('src="/_files/allowed.png"');
	expect(html).toContain('href="/course/files/homework/assets/private.png"');
	expect(html).not.toContain('src="/_files/private.png"');
	expect(html).not.toContain('href="javascript:');
	expect(html).not.toContain('src="javascript:');
});
