import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { ContentManifest } from '../../src/lib/types';
import type { CourseFile } from '../../src/lib/files';
import { parseGitmodules } from '../../tooling/lib/lastmod';

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
		const expectedLandings = parseGitmodules('../.gitmodules')
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
			if (course === 'des-inv') continue;
			const publicNotes = Object.values(manifest.pages)
				.filter((page) => page.publication.public && page.relativePath.startsWith(`${course}/`))
				.map((page) => page.relativePath.slice(course.length + 1))
				.sort();
			expect(
				files
					.filter((file) => !file.locked)
					.map((file) => file.path)
					.sort()
			).toEqual(publicNotes);
			expect(
				files.filter((file) => file.locked).every((file) => !file.download && !file.history)
			).toBe(true);
			if (course === 'fa26-philos244') continue;
			const details = `/${course}/course-details`;
			expect(sitemap).not.toContain(details);
			await page.goto(details);
			await expect(page.getByText('Content locked', { exact: true })).toBeVisible();
			const fullFiles: CourseFile[] = await (
				await request.get(`/_files/index/${course}.json`)
			).json();
			const privateFile = fullFiles.find((file) => file.path === 'course-details.md')!;
			expect((await anonymous.request.get(privateFile.download!)).status()).toBe(401);
		}
	} finally {
		await anonymous.close();
	}
});
