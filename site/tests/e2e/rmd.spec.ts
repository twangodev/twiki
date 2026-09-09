import { expect, test } from '@playwright/test';

test('Rmd worksheets run in the browser with plots, shared state, CSV data, and reset', async ({
	page
}) => {
	test.setTimeout(240_000);
	for (const name of ['lecture-03.Rmd', 'lecture-02.Rmd']) {
		await page.goto(`/fa26-stat324/files/lectures/worksheets/${name}`);
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
