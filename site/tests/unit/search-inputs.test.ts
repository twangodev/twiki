import { describe, expect, test } from 'bun:test';
import type { ContentManifest, PageDoc } from '../../src/lib/types';
import { noteSearchInput, searchHtmlInputs } from '../../tooling/lib/search-inputs.js';
import { fileSearchRecord } from '../../tooling/lib/file-search.js';

function page(overrides: Partial<PageDoc> = {}): PageDoc {
	return {
		slug: 'course/notes',
		title: 'Course <title>',
		html: '<h1 id="original">Original heading</h1><p>Body needle</p><h2 id="section">Section needle</h2>',
		tags: ['topic', 'CaseSensitive'],
		locked: false,
		dates: { created: '', published: '', modified: '2026-01-01T00:00:00Z' },
		publication: { public: true },
		description: 'Useful description',
		links: [],
		backlinks: [],
		wordCount: 8,
		readingTime: 1,
		hasMermaid: false,
		relativePath: '',
		toc: [],
		...overrides
	};
}

describe('compiled search HTML', () => {
	test('retains original headings, content, repeated filters and explicit title', () => {
		const input = noteSearchInput(page())!;
		expect(input.url).toBe('/course/notes');
		expect(input.content).toContain('<h1 id="original">Original heading</h1>');
		expect(input.content).toContain('<h2 id="section">Section needle</h2>');
		expect(input.content).toContain('data-pagefind-filter="course">course');
		expect(input.content.match(/data-pagefind-filter="tag"/g)).toHaveLength(2);
		expect(input.content).toContain('data-pagefind-meta="title">Course &lt;title&gt;');
		expect(input.content).not.toMatch(/Backlinks|Search site|Copy markdown/);
	});
	test('matches leading-H1 fallback, homepage metadata omission and canonical index URL', () => {
		const input = noteSearchInput(page({ slug: 'course/index', html: '<p>Intro</p>' }))!;
		expect(input.url).toBe('/course');
		expect(input.content).toContain('<h1>Course &lt;title&gt;</h1><p>Intro</p>');
		const home = noteSearchInput(page({ slug: 'index' }))!;
		expect(home.url).toBe('/');
		expect(home.content).not.toContain('data-pagefind-meta');
		expect(home.content).not.toContain('data-pagefind-filter');
	});
	test('locked note bodies never enter the index', () => {
		expect(noteSearchInput(page({ locked: true, html: '<p>Private secret</p>' }))).toBeUndefined();
	});
	test('includes meaningful folder/tag routes without indexing the shell or locked bodies', () => {
		const docs = {
			index: page({ slug: 'index', tags: [] }),
			'course/notes': page(),
			'course/locked': page({ slug: 'course/locked', locked: true, html: '<p>Private secret</p>' })
		};
		const manifest = {
			pages: docs,
			folders: ['course'],
			tags: { topic: ['course/notes'] },
			tree: {
				name: 'wisconsin',
				slug: '',
				pages: [{ slug: 'index', title: 'Home' }],
				children: [
					{
						name: 'course',
						slug: 'course',
						children: [],
						pages: [
							{ slug: 'course/notes', title: 'Notes' },
							{ slug: 'course/locked', title: 'Locked' }
						]
					}
				]
			}
		} as unknown as ContentManifest;
		const inputs = searchHtmlInputs(manifest, (slug) => docs[slug as keyof typeof docs]);
		expect(inputs.map((input) => input.url)).toEqual([
			'/',
			'/course',
			'/course/notes',
			'/tags',
			'/tags/topic'
		]);
		expect(inputs.find((input) => input.url === '/course')!.content).toContain(
			'2 items under this folder.'
		);
		expect(inputs.find((input) => input.url === '/tags/topic')!.content).toContain(
			'Useful description'
		);
		expect(inputs.map((input) => input.content).join('')).not.toContain('Private secret');
	});
	test('file records preserve filenames, encoded URLs and course filters', () => {
		expect(fileSearchRecord({ course: 'course', file: 'a b/model.Rmd' })).toEqual({
			url: '/course/files/a%20b/model.Rmd',
			content: 'course a b/model.Rmd',
			language: 'en',
			meta: { title: 'model.Rmd' },
			filters: { course: ['course'] }
		});
	});
});

export { page };
