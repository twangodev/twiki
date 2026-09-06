import { expect, test } from 'bun:test';
import { breadcrumbs, contentAuthor, noteSchema, serializeSchema } from '../src/lib/metadata';
import type { ManifestPage } from '../src/lib/types';

const page: ManifestPage = {
	slug: 'course/lecture',
	title: 'A note',
	description: 'An explanation.',
	tags: ['cs'],
	publication: { public: true },
	dates: {
		created: '2024-01-01T00:00:00.000Z',
		modified: '2024-02-01T00:00:00.000Z',
		published: ''
	},
	links: [],
	backlinks: [],
	wordCount: 100,
	readingTime: 1,
	hasMermaid: false,
	relativePath: 'course/lecture.md'
};

test('public notes have dates, breadcrumbs and curation without invented authorship', () => {
	const schemas = noteSchema('/course/lecture', page);
	expect(schemas[1]).toMatchObject({
		'@type': 'Article',
		dateModified: page.dates.modified,
		editor: { name: 'James Ding' }
	});
	expect(schemas[1]).not.toHaveProperty('datePublished');
	expect(schemas[1]).not.toHaveProperty('author');
	expect(schemas[2]).toMatchObject({
		'@type': 'BreadcrumbList',
		itemListElement: [
			{ position: 1, name: 'Home' },
			{ position: 2, name: 'course' },
			{ position: 3, name: 'A note' }
		]
	});
	expect(breadcrumbs('', 'Home')).toEqual([]);
});

test('course overviews have authors and licensed material retains source attribution', () => {
	expect(noteSchema('/course/README', { ...page, slug: 'course/README' })[1]).toMatchObject({
		'@type': 'CollectionPage',
		author: { name: 'James Ding' }
	});
	const license = {
		name: 'CC BY',
		url: 'https://example.com/license',
		attribution: 'Original source',
		source: 'https://example.com/source'
	};
	const schema = noteSchema('/course/lecture', { ...page, license })[1];
	expect(schema).toMatchObject({
		creditText: license.attribution,
		isBasedOn: license.source,
		license: license.url
	});
	expect(schema).not.toHaveProperty('author');
});

test('private notes never emit article structured data', () => {
	expect(noteSchema('/course/lecture', { ...page, locked: true })).toEqual([]);
	expect(noteSchema('/course/lecture', { ...page, publication: { public: false } })).toEqual([]);
});

test('untrusted metadata cannot escape JSON-LD or create unsafe author links', () => {
	const value = { name: '</script><script>alert(1)</script>&' };
	const serialized = serializeSchema(value);
	expect(serialized).not.toContain('<');
	expect(JSON.parse(serialized)).toEqual(value);
	expect(contentAuthor({ name: 'A writer', url: 'javascript:alert(1)' })).toEqual({
		name: 'A writer',
		type: 'Person'
	});
	expect(contentAuthor(' ')).toBeUndefined();
});
