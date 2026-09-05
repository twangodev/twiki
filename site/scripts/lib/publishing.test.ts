import { expect, test } from 'bun:test';
import { parsePublishPolicy, publicationDecision } from './publishing';

test('publication is opt-in, relative to one course, with exclusions winning', () => {
	const policy = parsePublishPolicy(
		'include:\n  - notes/**/*.md\n  - p01/src/*.java\nexclude:\n  - notes/exams/**\n'
	);
	for (const file of ['notes/one.md', 'notes/week 1/two.md', 'p01/src/Main.java'])
		expect(publicationDecision(file, policy).public).toBe(true);
	for (const file of ['notes/exams/one.md', 'slides.pdf', 'p02/src/Main.java', 'notes/image.png'])
		expect(publicationDecision(file, policy).public).toBe(false);
	expect(publicationDecision('notes/one.md').public).toBe(false);
	expect(publicationDecision('notes/one.md', parsePublishPolicy('include: []')).public).toBe(false);
});

test('policy files and hidden paths cannot be published even by a course-wide wildcard', () => {
	const policy = parsePublishPolicy('include: ["**"]');
	for (const file of ['publish.yaml', 'nested/publish.yaml', '.env', 'a/../b', '/outside', 'a\\b'])
		expect(publicationDecision(file, policy).public).toBe(false);
});

test('invalid policies fail closed rather than silently widening publication', () => {
	for (const source of [
		'',
		'[]',
		'public: true',
		'include: notes',
		'include: [true]',
		'include: [null]',
		'include: []\ninclude: ["**"]',
		'include: []\nexlude: []',
		'include: ["../notes/**"]',
		'include: ["/notes/**"]',
		'include: ["notes/**x"]',
		'include: ["!slides/**"]',
		'include: ["notes/{a,b}.md"]',
		'include: []\nexclude: false',
		'include: &paths ["**"]\nexclude: *paths'
	])
		expect(() => parsePublishPolicy(source)).toThrow();
});
