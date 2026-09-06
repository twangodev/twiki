import { expect, test } from '@playwright/test';

test('public metadata matches visible dates, attribution and breadcrumbs', async ({
	browser,
	baseURL
}) => {
	const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
	try {
		const page = await context.newPage();
		for (const [route, type] of [
			['/sp26-cs544/README', 'CollectionPage'],
			['/des-inv/cnc/cnc-1', 'Article']
		]) {
			await page.goto(route);
			const schemas = await page
				.locator('script[type="application/ld+json"]')
				.evaluateAll((nodes) => nodes.map((node) => JSON.parse(node.textContent!)));
			const article = schemas.find((schema) => schema['@type'] === type);
			expect(article).toBeTruthy();
			const image = await page.locator('meta[property="og:image"]').getAttribute('content');
			expect(article.image).toEqual([image]);
			await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute(
				'content',
				'1200'
			);
			await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute(
				'content',
				'630'
			);
			await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
				'content',
				'summary_large_image'
			);
			await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', image!);
			const response = await context.request.get(new URL(image!).pathname);
			expect(response.status()).toBe(200);
			expect(response.headers()['content-type']).toContain('image/png');
			const png = await response.body();
			expect(png.readUInt32BE(16)).toBe(1200);
			expect(png.readUInt32BE(20)).toBe(630);
			expect(article.url).toBe('https://wisconsin.twango.dev' + route);
			expect(article.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			await expect(page.locator('.doc-meta time').last()).toHaveAttribute(
				'datetime',
				article.dateModified
			);
			await expect(page.locator('meta[property="article:modified_time"]')).toHaveAttribute(
				'content',
				article.dateModified
			);
			const trail = schemas.find((schema) => schema['@type'] === 'BreadcrumbList').itemListElement;
			const visible = await page
				.getByRole('navigation', { name: 'Breadcrumbs' })
				.locator('li:not([aria-hidden])')
				.allTextContents();
			expect(trail.map((item: { name: string }) => item.name)).toEqual(
				visible.map((text) => text.trim())
			);
			await expect(
				page.locator('link[rel="alternate"][type="application/rss+xml"]')
			).toHaveAttribute('href', '/index.xml');
			if (route.includes('des-inv')) {
				expect(article).not.toHaveProperty('author');
				expect(article.creditText).toContain('TEAMLab');
				expect(article.license).toContain('creativecommons.org');
				await expect(page.locator('.doc-meta')).toContainText('Curated by James Ding');
			} else {
				expect(article.author.name).toBe('James Ding');
				await expect(page.locator('.doc-meta')).toContainText('By James Ding');
			}
		}
		await page.goto('/sp26-cs544/lectures/lecture-01');
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
			'content',
			'noindex, nofollow'
		);
		await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
		await expect(page.locator('meta[property^="article:"]')).toHaveCount(0);
		await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', '');
		await expect(page.locator('.doc-meta time')).toHaveCount(0);
		await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
			'content',
			'https://wisconsin.twango.dev/_og/notes/sp26-cs544/lectures/lecture-01.png'
		);
		expect(
			(await context.request.get('/_og/notes/sp26-cs544/lectures/lecture-01.png')).status()
		).toBe(200);
	} finally {
		await context.close();
	}
});
