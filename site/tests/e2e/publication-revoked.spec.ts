import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { CourseFile } from '../../src/lib/files';

test.skip(process.env.PUBLICATION_TEST !== 'revoked', 'Uses the revoked publication fixture');

test('removing publication rules closes old pages, data, files and derivatives after a rebuild', async ({
	browser,
	baseURL,
	request
}) => {
	const assets = JSON.parse(readFileSync('.generated/public-assets.json', 'utf8'));
	expect(Object.keys(assets).some((url) => url.startsWith('/_files/blobs/'))).toBe(false);
	expect(assets['/_og/notes/sp99-cs101/notes/public.png']).toBe(
		'/_published/_og/notes/sp99-cs101/notes/public.png'
	);
	const anonymous = await browser.newContext({
		baseURL,
		storageState: { cookies: [], origins: [] }
	});
	try {
		for (const method of ['GET', 'HEAD']) {
			expect(
				(
					await anonymous.request.fetch('/_og/notes/sp99-cs101/notes/public.png', { method })
				).status()
			).toBe(200);
		}
		const files: CourseFile[] = await (await request.get('/_files/index/sp99-cs101.json')).json();
		const download = files.find((file) => file.path === 'p01/Main.java')!.download!;
		for (const url of [
			'/',
			'/sp99-cs101',
			'/sp99-cs101/notes/public',
			'/sp99-cs101/notes/public/__data.json',
			'/sp99-cs101/files/p01/Main.java',
			'/_files/index/sp99-cs101.json',
			download,
			'/graph.json',
			'/pagefind/pagefind.js',
			'/sitemap.xml'
		]) {
			expect((await request.get(url)).status()).toBe(200);
			for (const method of ['GET', 'HEAD']) {
				const response = await anonymous.request.fetch(url, { method, maxRedirects: 0 });
				expect(response.status()).toBe(url === download ? 401 : 200);
				expect(await response.text()).not.toMatch(
					/publicsearchcanary|class Main|lectureprivatecanary/
				);
			}
		}
		const page = await anonymous.newPage();
		await page.goto('/sp99-cs101/notes/public');
		await expect(page.getByText('Content locked', { exact: true })).toBeVisible();
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
			'content',
			'noindex, nofollow'
		);
		expect(await (await anonymous.request.get('/sitemap.xml')).text()).not.toContain(
			'/notes/public'
		);
	} finally {
		await anonymous.close();
	}
});
