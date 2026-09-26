import { expect, test } from 'bun:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { targetRenderer } from '../../tooling/check-targets';

const content = '/tmp/test-vault';
const files = [
	'course-log.md',
	'course/lectures/index.md',
	'course/lectures/lecture-01.md',
	'other/lectures/lecture-01.md',
	'course/lectures/assets/plot one.png',
	'course/homework/hw3.Rmd',
	'course/homework/flush.csv'
].map((file) => path.join(content, file));
const render = targetRenderer(content, files);
const fileUrl = (file: string) => pathToFileURL(path.join(content, file)).href;

test('Lychee receives actual files for nearest, vault-root, worksheet, and relative asset links', () => {
	const html = render(
		path.join(content, 'course/lectures/index.md'),
		[
			'[[lecture-01|Lecture]]',
			'[[course/homework/hw3.Rmd|Homework]]',
			'![[assets/plot one.png]]',
			'[Data](../homework/flush.csv)',
			'| Link |',
			'| --- |',
			'| [[lectures/lecture-01\\|Lecture 1]] |'
		].join('\n')
	);
	const lines = html.split('\n');
	expect(lines[0]).toContain(fileUrl('course/lectures/lecture-01.md'));
	expect(lines[1]).toContain(fileUrl('course/homework/hw3.Rmd'));
	expect(lines[2]).toContain(fileUrl('course/lectures/assets/plot one.png'));
	expect(lines[3]).toContain(fileUrl('course/homework/flush.csv'));
	expect(lines[6]).toContain(fileUrl('course/lectures/lecture-01.md'));
	expect(html).not.toContain(fileUrl('other/lectures/lecture-01.md'));
});

test('missing targets survive for Lychee to reject, while code, metadata, and comments are excluded', () => {
	const html = render(
		path.join(content, 'course/lectures/index.md'),
		[
			'---',
			'source: "[[not-a-link]]"',
			'---',
			'`[[not-a-link]]`',
			'```{r}',
			'# [[not-a-link]]',
			'```',
			'%% [[not-a-link]] %%',
			'<!-- [[not-a-link]] -->',
			'[[missing-file]]',
			'[External](https://example.com)'
		].join('\n')
	);
	expect(html).not.toContain('not-a-link');
	expect(html).not.toContain('example.com');
	expect(html.split('\n')[9]).toContain(fileUrl('missing-file'));
});

test('root index transclusions resolve to their Markdown source', () => {
	const html = render(path.join(content, 'index.md'), '![[course-log]]');
	expect(html).toContain(fileUrl('course-log.md'));
});

test('parent-relative wikilinks use the same source directory as the renderer', () => {
	const html = render(
		path.join(content, 'course/lectures/index.md'),
		'[[../homework/hw3.Rmd|Homework]]'
	);
	expect(html).toContain(fileUrl('course/homework/hw3.Rmd'));
});
