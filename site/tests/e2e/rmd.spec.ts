import { expect, test } from '@playwright/test';

test('worksheets open as typeset build output without loading interactive R', async ({ page }) => {
	const runtimeRequests: string[] = [];
	page.on('request', (request) => {
		if (/webr|\.wasm(?:\?|$)|FileRmd/i.test(request.url())) runtimeRequests.push(request.url());
	});
	await page.goto('/fa26-stat324/files/lectures/worksheets/lecture-02.Rmd');
	const document = page.getByRole('article', { name: 'Rendered worksheet' });
	await expect(document).toBeVisible();
	await expect(document.locator('img').first()).toBeVisible();
	expect(await document.locator('img').count()).toBeGreaterThan(1);
	await expect(document).toContainText('[1]');
	await expect(page.getByRole('button', { name: 'Read', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(page.getByRole('button', { name: 'Run all', exact: true })).toHaveCount(0);
	expect(runtimeRequests).toEqual([]);
	await page.evaluate(() => window.document.fonts.ready);
	await page.screenshot({
		path: 'build/generated/rmd-reading-desktop.png',
		animations: 'disabled'
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.getByRole('group', { name: 'Worksheet view' })).toBeInViewport();
	for (const name of ['Read', 'Interactive', 'Source'])
		await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
	await page.screenshot({ path: 'build/generated/rmd-reading-mobile.png', animations: 'disabled' });
	await page.getByRole('button', { name: 'Interactive', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Run all', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Read', exact: true }).click();
	await expect(document).toBeVisible();
	await page.getByRole('button', { name: 'Source', exact: true }).click();
	await expect(page.locator('.file-code .cm-line').first()).toBeVisible();
	await page.goto('/fa26-stat324/files/homework/hw2.Rmd');
	await expect(document).toBeVisible();
	await expect(document.locator('.katex').first()).toBeVisible();
	await expect(document).not.toContainText('\\vspace');
});

test('the file browser explains its JavaScript requirement while notes remain readable without it', async ({
	browser,
	baseURL
}) => {
	const context = await browser.newContext({
		baseURL,
		javaScriptEnabled: false,
		storageState: 'build/generated/auth-state.json'
	});
	try {
		const page = await context.newPage();
		await page.goto('/fa26-stat324/files/lectures/worksheets/lecture-03.Rmd');
		// Playwright's text selector excludes noscript, even with JavaScript disabled.
		await expect(page.locator('noscript p')).toHaveText(
			'Enable JavaScript to use the file browser.'
		);
		await expect(page.locator('noscript p')).toBeVisible();
		await page.goto('/fa26-stat324/README');
		await expect(page.locator('main h1')).toBeVisible();
		await expect(page.locator('noscript')).toHaveCount(0);
	} finally {
		await context.close();
	}
});

test('Rmd worksheets run in the browser with plots, shared state, CSV data, and reset', async ({
	page
}) => {
	test.setTimeout(240_000);
	await page.goto('/fa26-stat324/README');
	const notes = page
		.getByRole('group', { name: 'Explorer view' })
		.getByRole('button', { name: 'Notes', exact: true });
	await expect(notes).toHaveAttribute('aria-pressed', 'true');
	const navigation = page.getByRole('navigation', { name: 'Documentation', exact: true });
	await navigation.getByRole('button', { name: 'Toggle Lectures', exact: true }).click();
	await navigation.getByRole('button', { name: 'Toggle Worksheets', exact: true }).click();
	await navigation.getByRole('link', { name: 'Lecture 02 (R worksheet)', exact: true }).click();
	await expect(notes).toHaveAttribute('aria-pressed', 'true');
	await expect(
		navigation.getByRole('link', { name: 'Lecture 02 (R worksheet)', exact: true })
	).toHaveAttribute('aria-current', 'page');
	await page.getByRole('button', { name: 'Interactive', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Run all', exact: true })).toBeVisible();
	for (const name of ['lecture-03.Rmd', 'lecture-02.Rmd']) {
		await page.goto(`/fa26-stat324/files/lectures/worksheets/${name}`);
		await expect(notes).toHaveAttribute('aria-pressed', 'true');
		await page.getByRole('button', { name: 'Interactive', exact: true }).click();
		await page.getByRole('button', { name: 'Run all', exact: true }).click();
		await expect(page.getByRole('status').filter({ hasText: 'Finished.' })).toBeVisible({
			timeout: 180_000
		});
		expect(await page.locator('img[alt^="R plot"]').count()).toBeGreaterThan(1);
	}
	const chunk = page.locator('section[aria-label]').last();
	await chunk
		.locator('textarea')
		.fill('nrow(read.csv("Thickness_Data.csv"))\nbrowser_test_value <- 42');
	await chunk.getByRole('button', { name: 'Run chunk', exact: true }).click();
	await expect(chunk.locator('pre')).toContainText('[1] 35');
	await chunk.locator('textarea').fill('stop("deliberate test error")');
	await chunk.getByRole('button', { name: 'Run chunk', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'deliberate test error' })).toBeVisible();
	await chunk.locator('textarea').fill('browser_test_value + 1');
	await chunk.getByRole('button', { name: 'Run chunk', exact: true }).click();
	await expect(chunk.locator('pre')).toContainText('[1] 43');
	await chunk.locator('textarea').fill('while (TRUE) {}');
	await chunk.getByRole('button', { name: 'Run chunk', exact: true }).click();
	await page.getByRole('button', { name: 'Stop and reset', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'session reset' })).toBeVisible();
	await chunk.locator('textarea').fill('exists("browser_test_value")');
	await chunk.getByRole('button', { name: 'Run chunk', exact: true }).click();
	await expect(chunk.locator('pre')).toContainText('FALSE', { timeout: 180_000 });
	await page.getByRole('button', { name: 'Source', exact: true }).click();
	await expect(page.locator('.file-code .cm-line').first()).toBeVisible();
});
