import { expect, test, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import path from 'node:path';
import { publicationFixture } from '../publication-fixture';
import { resolveProject } from '../../tooling/lib/project-config';
import {
	parsePublishPolicy,
	publicationDecision,
	publicationResolver,
	courseLicenseResolver,
	withPublicationPolicies
} from '../../tooling/lib/publishing';

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
		'include: []\nexclude: null',
		'include: &paths ["**"]\nexclude: *paths'
	])
		expect(() => parsePublishPolicy(source)).toThrow();
});

test('license metadata records attribution without granting public access', () => {
	const license = {
		name: 'CC BY 4.0',
		url: 'https://creativecommons.org/licenses/by/4.0/',
		attribution: 'Example author',
		source: 'https://example.com/course',
		changes: 'Reformatted as Markdown.'
	};
	const policy = parsePublishPolicy(JSON.stringify({ include: [], license }));
	expect(policy.license).toEqual(license);
	expect(publicationDecision('notes.md', policy).public).toBe(false);
	for (const invalid of [
		null,
		'CC BY',
		{},
		{ ...license, typo: true },
		{ ...license, attribution: '' },
		{ ...license, source: 'javascript:alert(1)' },
		{ ...license, url: 'https://user:secret@example.com' },
		{ ...license, changes: false }
	])
		expect(() =>
			parsePublishPolicy(JSON.stringify({ include: ['**'], license: invalid }))
		).toThrow();
});

test('one asynchronous publication scope shares checked policies, while fresh scopes see revocations and failures', async () => {
	const fixture = publicationFixture();
	const project = resolveProject(fixture.repo, fixture.repo, {});
	const policy = path.join(fixture.course, 'publish.yaml');
	const note = 'sp99-cs101/notes/public.md';
	const read = spyOn(fs, 'readFileSync');
	try {
		await withPublicationPolicies(async () => {
			expect(publicationResolver(fixture.repo, project)(note).public).toBe(true);
			await Promise.resolve();
			expect(courseLicenseResolver(fixture.repo, project)(note)?.name).toBe('CC BY 4.0');
			expect(publicationResolver(fixture.repo, project)(note).public).toBe(true);
			expect(read.mock.calls.filter(([file]) => file === policy)).toHaveLength(1);
			fixture.write('content/sp99-cs101/publish.yaml', 'include: []\n');
			expect(publicationResolver(fixture.repo, project)(note).public).toBe(true);
			withPublicationPolicies(() => {
				expect(publicationResolver(fixture.repo, project)(note).public).toBe(false);
				expect(courseLicenseResolver(fixture.repo, project)(note)).toBeUndefined();
			});
		});
		expect(publicationResolver(fixture.repo, project)(note).public).toBe(false);
		fixture.write('content/sp99-cs101/publish.yaml', 'include: invalid\n');
		expect(() => withPublicationPolicies(() => publicationResolver(fixture.repo, project))).toThrow(
			'invalid or untracked'
		);
		fixture.write('content/sp99-cs101/publish.yaml', 'include: ["**"]\n');
		expect(
			withPublicationPolicies(() => publicationResolver(fixture.repo, project)(note).public)
		).toBe(true);
		fs.renameSync(policy, policy + '.outside');
		fs.symlinkSync(policy + '.outside', policy);
		expect(() => withPublicationPolicies(() => publicationResolver(fixture.repo, project))).toThrow(
			'invalid or untracked'
		);
	} finally {
		read.mockRestore();
		fs.rmSync(fixture.repo, { recursive: true, force: true });
	}
});
