import { expect, test } from '@playwright/test';

test.skip(process.env.PUBLICATION_TEST !== 'updated', 'Uses the updated publication snapshot');

test('a content-only snapshot refreshes SSR, hydration, navigation and search', async ({
	browser,
	baseURL,
	request
}) => {
	const note = '/sp99-cs101/notes/public';
	const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
	try {
		for (const client of [request, context.request]) {
			const response = await client.get(note);
			expect(response.status()).toBe(200);
			const html = await response.text();
			expect(html).toContain('Updated public derivations');
			expect(html).toContain('snapshotupdatedcanary');
			expect(html).not.toContain('publicsearchcanary');
			const data = await client.get(`${note}/__data.json`);
			expect(data.status()).toBe(200);
			expect(await data.text()).toContain('snapshotupdatedcanary');
			expect(await data.text()).not.toContain('publicsearchcanary');
		}
		const page = await context.newPage();
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.goto(note);
		await expect(page.getByRole('heading', { name: 'Updated public derivations' })).toBeVisible();
		await page.locator('article').getByRole('link', { name: 'Next derivation' }).click();
		await expect(page.getByRole('heading', { name: 'Updated second derivation' })).toBeVisible();
		await page.goBack();
		await expect(page.getByRole('heading', { name: 'Updated public derivations' })).toBeVisible();
		await page.reload();
		await expect(page.locator('article')).toContainText('snapshotupdatedcanary');
		const results = await page.evaluate(async () => {
			const url = '/pagefind/pagefind.js';
			const search = await import(/* @vite-ignore */ url);
			await search.init();
			return {
				updated: (await search.search('snapshotupdatedcanary')).results.length,
				previous: (await search.search('\"publicsearchcanary\"')).results.length,
				private: (await search.search('\"lectureprivatecanary\"')).results.length
			};
		});
		expect(results.updated).toBeGreaterThan(0);
		expect(results.previous).toBe(0);
		expect(results.private).toBe(0);
		expect(errors).toEqual([]);
	} finally {
		await context.close();
	}
});
