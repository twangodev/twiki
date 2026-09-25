import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ContentManifest } from '../../src/lib/types';
import type { CourseFile } from '../../src/lib/files';
import { parseGitmodules } from '../../tooling/lib/lastmod';
import { publicationFilter } from '../../tooling/lib/publishing';

const repo = path.resolve(process.env.WISCONSIN_CONTENT_REPO ?? '..');
const isPublic = publicationFilter(repo);

const manifest: ContentManifest = JSON.parse(
	readFileSync('build/generated/content-manifest.json', 'utf8')
);
const landings = Object.values(manifest.pages).filter((note) => /^[^/]+\/README$/.test(note.slug));

test('every course has an indexable public overview without opening its materials', async ({
	browser,
	baseURL,
	request
}) => {
	test.setTimeout(90_000);
	const anonymous = await browser.newContext({
		baseURL,
		storageState: { cookies: [], origins: [] }
	});
	try {
		const expectedLandings = parseGitmodules(path.join(repo, '.gitmodules'))
			.filter(({ path }) => path.startsWith('content/'))
			.map(({ path }) => path.slice('content/'.length) + '/README')
			.sort();
		expect(expectedLandings.length).toBeGreaterThan(0);
		expect(landings.map((note) => note.slug).sort()).toEqual(expectedLandings);
		const sitemap = await (await anonymous.request.get('/sitemap.xml')).text();
		const page = await anonymous.newPage();
		for (const note of landings) {
			const course = note.slug.split('/')[0];
			expect(note.publication.public, course).toBe(true);
			const response = await page.goto('/' + note.slug);
			expect(response?.status()).toBe(200);
			expect(response?.headers()['x-robots-tag']).toBeUndefined();
			await expect(page.getByLabel('Page visibility: Public')).toBeVisible();
			await expect(page.getByText('Content locked', { exact: true })).toHaveCount(0);
			expect(await page.title()).toContain(note.title);
			expect(await page.title()).not.toContain('README');
			await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
				'href',
				new RegExp(`/${note.slug}$`)
			);
			expect(sitemap).toContain('/' + note.slug);
			const links = await page
				.locator('article a.internal')
				.evaluateAll((elements) => elements.map((element) => element.getAttribute('href')));
			for (const href of links) {
				expect(href, note.slug).toMatch(new RegExp(`^/${course}/`));
				expect((await anonymous.request.get(href!)).status(), href!).toBe(200);
			}
			const files: CourseFile[] = await (
				await anonymous.request.get(`/_files/index/${course}.json`)
			).json();
			const readme = files.find((file) => file.path === 'README.md')!;
			expect(readme.download).toBeTruthy();
			expect((await anonymous.request.get(readme.download!)).status()).toBe(200);
			const fullFiles: CourseFile[] = JSON.parse(
				readFileSync(`static/_files/index/${course}.json`, 'utf8')
			);
			// Publication policies cover assets and source files as well as notes.
			const publicFiles = fullFiles
				.filter((file) => isPublic(`${course}/${file.path}`))
				.map((file) => file.path)
				.sort();
			expect(
				files
					.filter((file) => !file.locked)
					.map((file) => file.path)
					.sort()
			).toEqual(publicFiles);
			expect(
				files.filter((file) => file.locked).every((file) => !file.download && !file.history)
			).toBe(true);
			const privateNote = Object.values(manifest.pages).find(
				(page) => !page.publication.public && page.relativePath.startsWith(`${course}/`)
			);
			if (!privateNote) continue;
			const details = '/' + privateNote.slug;
			expect(sitemap).not.toContain(details);
			await page.goto(details);
			await expect(page.getByText('Content locked', { exact: true })).toBeVisible();
			const authenticatedFiles: CourseFile[] = await (
				await request.get(`/_files/index/${course}.json`)
			).json();
			const privateFile = authenticatedFiles.find(
				(file) => file.path === privateNote.relativePath.slice(course.length + 1)
			)!;
			expect(privateFile.download, privateNote.slug).toBeTruthy();
			expect((await anonymous.request.get(privateFile.download!)).status()).toBe(401);
		}
	} finally {
		await anonymous.close();
	}
});
