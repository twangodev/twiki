import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { ContentManifest } from '../../src/lib/types';
import type { CourseFile } from '../../src/lib/files';

test('des-inv is public with attribution while other courses and Git history stay private', async ({
	browser,
	baseURL,
	request
}) => {
	const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
	try {
		const manifest: ContentManifest = JSON.parse(
			readFileSync('.generated/content-manifest.json', 'utf8')
		);
		const notes = Object.values(manifest.pages).filter((note) => note.slug.startsWith('des-inv/'));
		expect(notes).toHaveLength(12);
		for (const note of notes) {
			const route = '/' + (note.slug.endsWith('/index') ? note.slug.slice(0, -6) : note.slug);
			const response = await context.request.get(route);
			expect(response.status(), route).toBe(200);
			expect(response.headers()['x-robots-tag']).toBeUndefined();
			const html = await response.text();
			expect(html).toContain('Page visibility: Public');
			expect(html).toContain('UW–Madison Design Innovation Lab (TEAMLab)');
			expect(html).toContain('rel="license"');
			expect(html).toContain('Converted to Markdown');
		}
		const files: CourseFile[] = await (
			await context.request.get('/_files/index/des-inv.json')
		).json();
		expect(files.some((file) => file.path === 'LICENSE')).toBe(true);
		expect(files.every((file) => file.license?.name === 'CC BY 4.0' && !file.history)).toBe(true);
		for (const file of files)
			expect((await context.request.get(file.download!)).status(), file.path).toBe(200);
		const graph = await (await context.request.get('/graph.json')).json();
		expect(graph).toEqual(manifest.graph);
		for (const url of [
			'/sp26-cs544/README',
			'/sp26-cs544/README/__data.json',
			'/_files/index/sp26-cs544.json'
		])
			expect((await context.request.get(url)).status()).toBe(200);
		const lockedFiles: CourseFile[] = await (
			await context.request.get('/_files/index/sp26-cs544.json')
		).json();
		expect(lockedFiles.every((file) => file.locked && !file.download && !file.history)).toBe(true);
		const full: CourseFile[] = await (await request.get('/_files/index/des-inv.json')).json();
		const history = full.find((file) => file.history)!.history!;
		expect((await request.get(history)).status()).toBe(200);
		expect((await context.request.get(history)).status()).toBe(401);
		const sitemap = await (await context.request.get('/sitemap.xml')).text();
		expect(sitemap).toContain('/des-inv/cnc/cnc-1');
		expect(sitemap).not.toContain('sp26-cs544/README');
		const page = await context.newPage();
		await page.goto('/des-inv/cnc/cnc-1');
		await expect(page.getByRole('complementary', { name: 'Content license' })).toBeVisible();
		await expect(page.locator('head link[rel="license"]')).toHaveAttribute(
			'href',
			'https://creativecommons.org/licenses/by/4.0/'
		);
		await page.setViewportSize({ width: 390, height: 844 });
		await expect
			.poll(() =>
				page
					.locator('.doc-sidebar-left')
					.evaluate((element) => element.getBoundingClientRect().right)
			)
			.toBeLessThanOrEqual(0);
		await page.getByRole('complementary', { name: 'Content license' }).scrollIntoViewIfNeeded();
		await page.screenshot({ path: '/tmp/wisconsin-des-inv-license.png' });
		await page.goto('/sp26-cs544/README');
		await expect(page.getByText('Content locked', { exact: true })).toBeVisible();
		await page.screenshot({ path: '/tmp/wisconsin-catalog-mobile.png' });
	} finally {
		await context.close();
	}
});
