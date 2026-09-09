import { expect, test } from 'bun:test';
import { parseRmd, relativeFile } from '../../src/lib/rmd';

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
