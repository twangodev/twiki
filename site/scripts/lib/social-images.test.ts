import { expect, test } from 'bun:test';
import { mkdtempSync, existsSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSocialImages } from '../../tooling/lib/social-images';
import { publicAssetManifest } from '../../tooling/lib/public-assets';
import type { ManifestPage } from '../../src/lib/types';

test('title-only share cards cover locked notes without exposing their content', async () => {
	const directory = mkdtempSync(path.join(tmpdir(), 'wisconsin-social-'));
	const note: ManifestPage = {
		slug: 'course/note',
		title: 'Notes on systems',
		description: 'An introduction to systems.',
		publication: { public: true },
		tags: [],
		dates: { created: '', modified: '', published: '' },
		links: [],
		backlinks: [],
		readingTime: 1,
		wordCount: 10,
		hasMermaid: false,
		relativePath: 'course/note.md'
	};
	const filename = path.join(directory, 'static/_og/notes/course/note.png');
	try {
		await buildSocialImages(directory, { pages: { [note.slug]: note } });
		const png = readFileSync(filename);
		expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
		expect(png.readUInt32BE(16)).toBe(1200);
		expect(png.readUInt32BE(20)).toBe(630);
		const cache = path.join(directory, '.generated/cache/social');
		const timestamp = statSync(cache).mtimeMs;
		await buildSocialImages(directory, { pages: { [note.slug]: note } });
		expect(readFileSync(filename)).toEqual(png);
		expect(statSync(cache).mtimeMs).toBe(timestamp);
		await buildSocialImages(directory, {
			pages: { [note.slug]: { ...note, publication: { public: false } } }
		});
		expect(readFileSync(filename)).toEqual(png);
		expect(publicAssetManifest(path.join(directory, 'static'), {})).toEqual({
			'/_og/default.png': '/_published/_og/default.png',
			'/_og/notes/course/note.png': '/_published/_og/notes/course/note.png'
		});
		await buildSocialImages(directory, {
			pages: { [note.slug]: { ...note, locked: true, description: 'private description canary' } }
		});
		expect(readFileSync(filename)).toEqual(png);
		await buildSocialImages(directory, { pages: {} });
		expect(existsSync(filename)).toBe(false);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
