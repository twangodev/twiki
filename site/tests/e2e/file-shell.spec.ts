import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

const first = '/fa24-cs300/files/p01/src/main/java/ElectionManager.java';
const second = '/fa24-cs300/files/README.md';

test('file routes share one static shell and have no per-route HTML or server-data payload', async ({
	request,
	browser,
	baseURL
}) => {
	const routes = JSON.parse(readFileSync('build/generated/public-routes.json', 'utf8'));
	expect(Object.keys(routes).some((route) => /^\/[^/]+\/files(?:\/|$)/.test(route))).toBe(false);
	expect(existsSync('build/generated/public-site/_file-browser.html')).toBe(true);
	expect(existsSync(`build/generated/public-site${first}.html`)).toBe(false);
	const full = await request.get(first);
	expect(full.status()).toBe(200);
	const html = await full.text();
	expect(html).toBe(await (await request.get(second)).text());
	expect(html).not.toContain('/_files/blobs/');
	expect((await request.get(first + '/__data.json')).status()).toBe(404);
	const anonymous = await browser.newContext({
		baseURL,
		storageState: { cookies: [], origins: [] }
	});
	try {
		const publicPage = await anonymous.request.get(first);
		expect(publicPage.status()).toBe(200);
		expect(publicPage.headers()['x-robots-tag']).toBe('noindex');
		expect(await publicPage.text()).toBe(await (await anonymous.request.get(second)).text());
		expect((await anonymous.request.get(first + '/__data.json')).status()).toBe(404);
		expect((await anonymous.request.get(first + '/missing')).status()).toBe(404);
		const head = await anonymous.request.head(first);
		expect(head.status()).toBe(200);
		expect(await head.text()).toBe('');
	} finally {
		await anonymous.close();
	}
});

test('file names stay searchable and public search results open the locked viewer', async ({
	browser,
	baseURL
}) => {
	const anonymous = await browser.newContext({
		baseURL,
		storageState: { cookies: [], origins: [] }
	});
	try {
		const page = await anonymous.newPage();
		await page.goto('/fa24-cs300');
		const urls: string[] = await page.evaluate(async () => {
			const moduleUrl = '/pagefind/pagefind.js';
			const search = await import(/* @vite-ignore */ moduleUrl);
			const result = await search.search('ElectionManager', { filters: { course: 'fa24-cs300' } });
			return Promise.all(
				result.results.map(
					async (entry: { data: () => Promise<{ url: string }> }) => (await entry.data()).url
				)
			);
		});
		expect(urls).toContain(first);
		await page.goto(first);
		await expect(page.getByText('Content locked', { exact: true })).toBeVisible();
		await page.reload();
		await expect(page.getByText('Content locked', { exact: true })).toBeVisible();
	} finally {
		await anonymous.close();
	}
});
