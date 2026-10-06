import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compilerCacheFiles } from '../../tooling/lib/cache-selection';

function fixture() {
	const directory = mkdtempSync(path.join(tmpdir(), 'wisconsin-cache-selection-'));
	const cache = path.join(directory, 'cache');
	mkdirSync(cache);
	const write = (file: string, value: unknown = 'cached') => {
		mkdirSync(path.dirname(path.join(cache, file)), { recursive: true });
		writeFileSync(
			path.join(cache, file),
			typeof value === 'string' ? value : JSON.stringify(value)
		);
	};
	return { cache, write, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

const parse = `stage1/aa/${'a'.repeat(64)}.json`;
const staleParse = `stage1/bb/${'b'.repeat(64)}.json`;
const publicCard = `social-titles/${'c'.repeat(64)}.png`;
const fullCard = `social-titles/${'d'.repeat(64)}.png`;
const staleCard = `social-titles/${'e'.repeat(64)}.png`;

test('cache transport selects current parser and both editions of cards without deleting local generations', () => {
	const { cache, write, cleanup } = fixture();
	try {
		for (const file of [parse, staleParse, publicCard, fullCard, staleCard]) write(file);
		write('stage1-current.json', [parse, parse]);
		write('social-titles-current-public.json', [publicCard]);
		write('social-titles-current-full.json', [fullCard, publicCard]);
		write('file-history/course/history.json');
		write('file-history/course/history.diff');
		write('../assets/_files/history/history.json');
		write('../assets/_files/history/history.diff');
		write('file-history/course/stale.json');
		write('file-history/course/revisions-version-head.jsonl');
		write('rmd/key/result.json');
		write('rmd/key/preview.png');
		write('gitdates-v3-course-version-head.json');
		write('credentials.env');
		const selected = compilerCacheFiles(cache);
		expect(selected).toContain(parse);
		expect(selected.filter((file) => file === parse)).toHaveLength(1);
		expect(selected).toContain(publicCard);
		expect(selected).toContain(fullCard);
		expect(selected).not.toContain(staleParse);
		expect(selected).not.toContain(staleCard);
		expect(selected).not.toContain('credentials.env');
		expect(selected).toContain('file-history/course/history.diff');
		expect(selected).not.toContain('file-history/course/stale.json');
		expect(selected).toContain('rmd/key/preview.png');
		expect(existsSync(path.join(cache, staleParse))).toBe(true);
		expect(existsSync(path.join(cache, staleCard))).toBe(true);
	} finally {
		cleanup();
	}
});

test('missing or malformed live manifests fail cold and cannot select paths outside their stage', () => {
	const { cache, write, cleanup } = fixture();
	try {
		write(parse);
		write(publicCard);
		expect(compilerCacheFiles(cache)).toEqual([]);
		write('stage1-current.json', [parse, '../../credentials.env']);
		write('social-titles-current-public.json', '{');
		write('social-titles-current-full.json', [parse]);
		expect(compilerCacheFiles(cache)).toEqual([]);
		write('stage1-current.json', [parse, staleParse]);
		expect(compilerCacheFiles(cache)).toEqual(['stage1-current.json', parse].sort());
	} finally {
		cleanup();
	}
});

test('manifest entries and recursive cache folders cannot follow symlinks', () => {
	const { cache, write, cleanup } = fixture();
	const outside = mkdtempSync(path.join(tmpdir(), 'wisconsin-cache-outside-'));
	try {
		write('stage1-current.json', [parse]);
		writeFileSync(path.join(outside, `${'a'.repeat(64)}.json`), 'private outside cache');
		mkdirSync(path.join(cache, 'stage1'));
		symlinkSync(outside, path.join(cache, 'stage1/aa'));
		symlinkSync(outside, path.join(cache, 'file-history'));
		expect(compilerCacheFiles(cache)).toEqual(['stage1-current.json']);
	} finally {
		cleanup();
		rmSync(outside, { recursive: true, force: true });
	}
});

test('missing full history outputs archive only revision lookup metadata', () => {
	const { cache, write, cleanup } = fixture();
	try {
		write('file-history/course/history.json');
		write('file-history/course/history.diff');
		write('file-history/course/revisions-version-head.jsonl');
		expect(compilerCacheFiles(cache)).toEqual(['file-history/course/revisions-version-head.jsonl']);
	} finally {
		cleanup();
	}
});
