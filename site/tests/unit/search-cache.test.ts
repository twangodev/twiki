import { afterEach, describe, expect, test } from 'bun:test';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	restoreSearchCache,
	saveSearchCache,
	searchInputKey,
	selectSearchCache
} from '../../tooling/lib/search-cache.js';

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
	const root = mkdtempSync(path.join(tmpdir(), 'wisconsin-search-cache-'));
	roots.push(root);
	const output = path.join(root, 'output');
	mkdirSync(path.join(output, 'fragment'), { recursive: true });
	writeFileSync(path.join(output, 'pagefind.js'), 'runtime');
	writeFileSync(path.join(output, 'pagefind-entry.json'), '{}');
	writeFileSync(path.join(output, 'fragment', 'en.pf_fragment'), 'search fragment');
	const cache = path.join(root, 'cache');
	const key = 'a'.repeat(64);
	const files = saveSearchCache(cache, output, key, 'public');
	return { root, output, cache, key, files, generation: path.join(cache, 'search/public', key) };
}

describe('complete search index cache', () => {
	test('keys exact HTML, file records, submission order, edition and Pagefind version', () => {
		const input = {
			html: [{ url: '/note', content: '<h1>Title</h1>' }],
			records: [{ url: '/file', content: 'file', language: 'en' }],
			pagefindVersion: '1.5.2',
			edition: 'public'
		};
		const key = searchInputKey(input);
		expect(searchInputKey(structuredClone(input))).toBe(key);
		for (const changed of [
			{ ...input, html: [{ url: '/note', content: '<h1>New title</h1>' }] },
			{ ...input, html: [] },
			{ ...input, records: [] },
			{ ...input, records: [{ ...input.records[0], filters: { course: ['new'] } }] },
			{ ...input, edition: 'full' },
			{ ...input, pagefindVersion: 'future' }
		])
			expect(searchInputKey(changed)).not.toBe(key);
	});
	test('restores after relocation and removes obsolete destination files', () => {
		const f = fixture();
		const relocated = path.join(f.root, 'other-checkout');
		cpSync(f.generation, relocated, { recursive: true });
		writeFileSync(path.join(f.output, 'stale.pf_fragment'), 'obsolete');
		expect(restoreSearchCache(relocated, f.output, f.key, 'public')).toBe(true);
		expect(readFileSync(path.join(f.output, 'fragment/en.pf_fragment'), 'utf8')).toBe(
			'search fragment'
		);
		expect(existsSync(path.join(f.output, 'stale.pf_fragment'))).toBe(false);
		selectSearchCache(f.cache, 'public', f.files);
		expect(
			JSON.parse(readFileSync(path.join(f.cache, 'search-current-public.json'), 'utf8'))
		).toEqual(f.files);
	});
	test('wrong key or edition, corruption and missing products fail closed without touching outputs', () => {
		const f = fixture();
		expect(restoreSearchCache(f.generation, f.output, 'b'.repeat(64), 'public')).toBe(false);
		expect(restoreSearchCache(f.generation, f.output, f.key, 'full')).toBe(false);
		const fragment = path.join(f.generation, 'files/fragment/en.pf_fragment');
		writeFileSync(fragment, 'corrupt');
		expect(restoreSearchCache(f.generation, f.output, f.key, 'public')).toBe(false);
		rmSync(fragment);
		expect(restoreSearchCache(f.generation, f.output, f.key, 'public')).toBe(false);
		expect(readFileSync(path.join(f.output, 'pagefind.js'), 'utf8')).toBe('runtime');
	});
	test('rejects symlinked cache products and traversal paths', () => {
		const f = fixture();
		const fragment = path.join(f.generation, 'files/fragment/en.pf_fragment');
		rmSync(fragment);
		symlinkSync(path.join(f.output, 'fragment/en.pf_fragment'), fragment);
		expect(restoreSearchCache(f.generation, f.output, f.key, 'public')).toBe(false);
		const manifestPath = path.join(f.generation, 'manifest.json');
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
		manifest.files[0].path = '../escape';
		writeFileSync(manifestPath, JSON.stringify(manifest));
		expect(restoreSearchCache(f.generation, f.output, f.key, 'public')).toBe(false);
	});
	test('rejects an accidentally truncated output inventory', () => {
		const f = fixture();
		const manifestPath = path.join(f.generation, 'manifest.json');
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
		manifest.files = manifest.files.filter(
			(file: { path: string }) => !file.path.startsWith('fragment/')
		);
		writeFileSync(manifestPath, JSON.stringify(manifest));
		expect(restoreSearchCache(f.generation, f.output, f.key, 'public')).toBe(false);
	});
});
