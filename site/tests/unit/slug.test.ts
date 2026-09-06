import { describe, expect, test } from 'bun:test';
import {
	type FilePath,
	type FullSlug,
	simplifySlug,
	slugifyFilePath,
	slugTag,
	splitAnchor,
	transformInternalLink,
	transformLink
} from '../../tooling/lib/slug';

const fp = (s: string) => s as FilePath;
const fs = (s: string) => s as FullSlug;

describe('slugifyFilePath', () => {
	test('strips md/html extensions only', () => {
		expect<unknown>(slugifyFilePath(fp('sp26-cs537/README.md'))).toBe('sp26-cs537/README');
		expect<unknown>(slugifyFilePath(fp('fa25-anthro105/assets/mystery-fossil-GREEN.html'))).toBe(
			'fa25-anthro105/assets/mystery-fossil-GREEN'
		);
		expect<unknown>(slugifyFilePath(fp('sp26-cs544/p4/hdma-wi-2021.sql.gz'))).toBe(
			'sp26-cs544/p4/hdma-wi-2021.sql.gz'
		);
		expect<unknown>(slugifyFilePath(fp('fa25-cs354/cheatsheet.pdf'))).toBe(
			'fa25-cs354/cheatsheet.pdf'
		);
	});

	test('is case-sensitive and replaces spaces with -', () => {
		expect<unknown>(
			slugifyFilePath(fp('fa25-cs354/homework/assets/Pasted image 20250922134012.png'))
		).toBe('fa25-cs354/homework/assets/Pasted-image-20250922134012.png');
	});

	test('replaces & with -and- and % with -percent', () => {
		expect<unknown>(slugifyFilePath(fp('notes/Pointers & Arrays.md'))).toBe(
			'notes/Pointers--and--Arrays'
		);
		expect<unknown>(slugifyFilePath(fp('notes/100% done.md'))).toBe('notes/100-percent-done');
	});

	test('strips ? and #', () => {
		expect<unknown>(slugifyFilePath(fp('notes/what?.md'))).toBe('notes/what');
		expect<unknown>(slugifyFilePath(fp('notes/c# basics.md'))).toBe('notes/c-basics');
	});

	test('treats _index as index', () => {
		expect<unknown>(slugifyFilePath(fp('folder/_index.md'))).toBe('folder/index');
	});

	test('html index keeps its index segment as a slug', () => {
		expect<unknown>(slugifyFilePath(fp('sp26-cs571/hw5/index.html'))).toBe('sp26-cs571/hw5/index');
	});
});

describe('simplifySlug', () => {
	test('trims trailing index', () => {
		expect<unknown>(simplifySlug(fs('index'))).toBe('/');
		expect<unknown>(simplifySlug(fs('sp26-cs537/index'))).toBe('sp26-cs537/');
		expect<unknown>(simplifySlug(fs('sp26-cs537/README'))).toBe('sp26-cs537/README');
		// 'index' only trimmed on a path boundary
		expect<unknown>(simplifySlug(fs('notes/reindex'))).toBe('notes/reindex');
	});
});

describe('splitAnchor', () => {
	test('slugifies heading anchors with github-slugger', () => {
		expect<unknown>(splitAnchor('textbook/ch-04#The Abstraction')).toEqual([
			'textbook/ch-04',
			'#the-abstraction'
		]);
	});

	test('PDF #page=N passes through raw', () => {
		expect<unknown>(splitAnchor('fa25-cs354/cheatsheet.pdf#page=3')).toEqual([
			'fa25-cs354/cheatsheet.pdf',
			'#page=3'
		]);
	});

	test('no anchor', () => {
		expect<unknown>(splitAnchor('sp26-cs537/README')).toEqual(['sp26-cs537/README', '']);
	});
});

describe('transformInternalLink', () => {
	test('keeps relative prefix and simplifies', () => {
		expect<unknown>(transformInternalLink('../exams/midterm-1/index.md')).toBe(
			'../exams/midterm-1/'
		);
		expect<unknown>(transformInternalLink('README.md')).toBe('./README');
	});
});

// real-corpus-shaped slug set: duplicate READMEs across courses, duplicate
// basenames at different depths, assets, folder indexes
const allSlugs = [
	'index',
	'course-log',
	'sp26-cs537/README',
	'sp26-cs537/p1/README',
	'sp26-cs537/p1/Instructions',
	'sp26-cs537/exams/midterm-1/review',
	'sp26-cs537/textbook/index',
	'sp26-cs537/textbook/ch-04',
	'sp26-cs537/lectures/lecture-02',
	'sp26-cs544/README',
	'sp26-cs544/p1/README',
	'sp26-cs544/p4/hdma-wi-2021.sql.gz',
	'fa25-cs354/README',
	'fa25-cs354/exams/exam-1/review',
	'fa25-cs354/homework/assets/Pasted-image-20250922134012.png',
	'fa25-cs354/exams/exam-1/assets/Pasted-image-20251001120000.png'
] as FullSlug[];

const opts = { strategy: 'shortest' as const, allSlugs };

// expectations below were verified against the fork's quartz/util/path.ts
// (commits c508392/8399e6e) executed directly with bun
describe('transformLink (fork nearest-match resolution)', () => {
	test('unique basename resolves anywhere (root-relative form)', () => {
		expect<unknown>(transformLink(fs('index'), 'course-log', opts)).toBe('./course-log');
		expect<unknown>(transformLink(fs('sp26-cs537/README'), 'Instructions', opts)).toBe(
			'../sp26-cs537/p1/Instructions'
		);
	});

	test('duplicate README: longest shared dir prefix with source wins', () => {
		expect<unknown>(transformLink(fs('sp26-cs537/p1/Instructions'), 'README', opts)).toBe(
			'../../sp26-cs537/p1/README'
		);
		// a README links to itself: own dir shares the longest prefix
		expect<unknown>(transformLink(fs('sp26-cs544/p1/README'), 'README', opts)).toBe(
			'../../sp26-cs544/p1/README'
		);
	});

	test('ambiguity tie-break: shallowest path after shared-prefix', () => {
		// src dir sp26-cs537/exams/midterm-1: both sp26-cs537/README (depth 1) and
		// sp26-cs537/p1/README (depth 2) share 1 segment -> shallowest wins
		expect<unknown>(transformLink(fs('sp26-cs537/exams/midterm-1/review'), 'README', opts)).toBe(
			'../../../sp26-cs537/README'
		);
	});

	test('zero shared prefix: shallowest then lexicographic', () => {
		// from the homepage all courses share 0 dirs; depth-1 candidates sorted
		// lexicographically -> fa25-cs354/README
		expect<unknown>(transformLink(fs('index'), 'README', opts)).toBe('./fa25-cs354/README');
	});

	test('path-suffix wikilink [[folder/file]] matches on / boundary', () => {
		expect<unknown>(transformLink(fs('sp26-cs537/README'), 'textbook/ch-04', opts)).toBe(
			'../sp26-cs537/textbook/ch-04'
		);
		expect<unknown>(transformLink(fs('index'), 'exam-1/review', opts)).toBe(
			'./fa25-cs354/exams/exam-1/review'
		);
	});

	test('heading anchor carried through and slugified', () => {
		expect<unknown>(
			transformLink(fs('sp26-cs537/README'), 'textbook/ch-04#The Abstraction', opts)
		).toBe('../sp26-cs537/textbook/ch-04#the-abstraction');
	});

	test('aliased link target resolves the same (alias only affects text)', () => {
		expect<unknown>(transformLink(fs('sp26-cs537/README'), 'lectures/lecture-02', opts)).toBe(
			'../sp26-cs537/lectures/lecture-02'
		);
	});

	test('folder-index wikilinks retain their course path', () => {
		expect<unknown>(transformLink(fs('sp26-cs537/p1/README'), 'textbook/index', opts)).toBe(
			'../../sp26-cs537/textbook/'
		);
	});

	test('duplicate folder indexes select the nearest course and preserve anchors', () => {
		const folders = {
			strategy: 'shortest' as const,
			allSlugs: ['sp26-cs537/lectures/index', 'sp26-cs544/lectures/index'].map(fs)
		};
		for (const target of [
			'lectures/index#Overview',
			'lectures/index.md#Overview',
			'lectures/#Overview'
		]) {
			expect<unknown>(transformLink(fs('sp26-cs544/README'), target, folders)).toBe(
				'../sp26-cs544/lectures/#overview'
			);
		}
	});

	test('asset link with spaces resolves to slugified asset path', () => {
		expect<unknown>(
			transformLink(
				fs('fa25-cs354/exams/exam-1/review'),
				'assets/Pasted image 20251001120000.png',
				opts
			)
		).toBe('../../../fa25-cs354/exams/exam-1/assets/Pasted-image-20251001120000.png');
	});

	test('zero matches -> root-absolute + (caller emits warning)', () => {
		expect<unknown>(transformLink(fs('sp26-cs537/p1/README'), 'no-such-page', opts)).toBe(
			'../../no-such-page'
		);
	});

	test('markdown ./ relative link resolves through suffix matching', () => {
		expect<unknown>(transformLink(fs('sp26-cs537/p1/README'), './Instructions.md', opts)).toBe(
			'../../sp26-cs537/p1/Instructions'
		);
	});

	test("markdown ../ relative link quirk: '..' prefix survives canonicalization and zero-matches", () => {
		// fork keeps the leading '../' inside the canonical slug ('./README'),
		// so suffix matching never fires and the absolute fallback emits '../.././README'
		expect<unknown>(transformLink(fs('sp26-cs537/p1/README'), '../README.md', opts)).toBe(
			'../.././README'
		);
	});

	test('PDF target keeps raw #page anchor through resolution', () => {
		expect<unknown>(
			transformLink(fs('fa25-cs354/README'), 'cheatsheet.pdf#page=3', {
				strategy: 'shortest',
				allSlugs: ['fa25-cs354/cheatsheet.pdf'] as FullSlug[]
			})
		).toBe('../fa25-cs354/cheatsheet.pdf#page=3');
	});
});

describe('slugTag', () => {
	test('case-sensitive tags', () => {
		expect<unknown>(slugTag('ELF')).toBe('ELF');
		expect<unknown>(slugTag('Placement policies')).toBe('Placement-policies');
		expect<unknown>(slugTag('cs/537')).toBe('cs/537');
	});
});
