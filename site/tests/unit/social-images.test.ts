import { expect, test } from 'bun:test';
import { mkdtempSync, existsSync, readFileSync, statSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSocialImages, renderSocialImage, socialCard } from '../../tooling/lib/social-images';
import { Resvg } from '@resvg/resvg-js';
import { publicAssetManifest } from '../../tooling/lib/public-assets';
import type { ManifestPage } from '../../src/lib/types';

test('share cards use the dark site palette and keep background linework off the title margin', async () => {
	const png = await renderSocialImage({
		title: 'Operating Systems',
		subtitle: 'README.md',
		label: 'CS 537'
	});
	const { pixels } = new Resvg(
		`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><image width="1200" height="630" href="data:image/png;base64,${png.toString('base64')}"/></svg>`
	).render();
	const pixel = (x: number, y: number) =>
		pixels.subarray((y * 1200 + x) * 4, (y * 1200 + x) * 4 + 3).toString('hex');
	expect(pixel(0, 300)).toBe('1a1916');
	expect(pixel(72, 200)).toBe('1a1916');
	const colors = new Set<string>();
	for (let i = 0; i < pixels.length; i += 4) colors.add(pixels.subarray(i, i + 3).toString('hex'));
	expect(colors.has('e8e5df')).toBe(true);
	expect(colors.has('e68578')).toBe(true);
});

test('share cards lead with the H1 and use the actual filename as a subtitle', () => {
	const page = {
		slug: 'sp26-cs537/README',
		title: 'README',
		heading: 'Operating Systems',
		relativePath: 'sp26-cs537/README.md'
	};
	expect(socialCard(page)).toEqual({
		slug: page.slug,
		title: 'Operating Systems',
		subtitle: 'README.md',
		label: 'CS 537 · Spring 2026'
	});
	expect(socialCard({ ...page, title: 'Frontmatter title' }).title).toBe('Operating Systems');
	expect(socialCard({ ...page, heading: undefined }).title).toBe('README');
	expect(socialCard({ ...page, heading: ' ' }).title).toBe('README');
});

test('title-only share cards cover locked notes without exposing their content', async () => {
	const directory = mkdtempSync(path.join(tmpdir(), 'wisconsin-social-'));
	const note: ManifestPage = {
		slug: 'course/note',
		title: 'Notes on systems',
		heading: 'Understanding operating systems',
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
		const cache = path.join(directory, '.generated/cache/social-titles');
		const timestamp = statSync(cache).mtimeMs;
		utimesSync(filename, 1, 1);
		await buildSocialImages(directory, { pages: { [note.slug]: note } });
		expect(readFileSync(filename)).toEqual(png);
		expect(statSync(filename).mtimeMs).toBe(1000);
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
		await buildSocialImages(directory, {
			pages: { [note.slug]: { ...note, heading: 'A different heading' } }
		});
		expect(readFileSync(filename)).not.toEqual(png);
		await buildSocialImages(directory, { pages: { [note.slug]: note } });
		await buildSocialImages(directory, { pages: {} });
		expect(existsSync(filename)).toBe(false);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
