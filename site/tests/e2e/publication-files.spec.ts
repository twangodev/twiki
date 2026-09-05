import { test, expect } from '@playwright/test';

test.skip(process.env.PUBLICATION_TEST !== 'files', 'Uses the file-only publication fixture');

test('a course can publish only project files without exposing its notes or requiring a public README', async ({
	browser,
	baseURL
}) => {
	const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
	try {
		const page = await context.newPage();
		await page.goto('/sp99-cs101');
		await expect(page.getByRole('heading', { name: 'sp99-cs101' })).toBeVisible();
		expect(await page.content()).not.toContain('overviewprivatecanary');
		await page.goto('/sp99-cs101/files/p01/Main.java');
		await expect(page.locator('.cm-content')).toContainText('class Main');
		const graph = await (await context.request.get('/graph.json')).json();
		expect(graph.nodes).toEqual([]);
		expect((await context.request.get('/sp99-cs101/notes/public')).status()).toBe(401);
		const sitemap = await (await context.request.get('/sitemap.xml')).text();
		expect(sitemap).toContain('https://wisconsin.twango.dev/sp99-cs101');
		expect(sitemap).not.toContain('/notes/');
	} finally {
		await context.close();
	}
});
