import { expect, test } from '@playwright/test';

const directory = '/fa24-cs300/files/p01/src/main/java';
const first = `${directory}/ElectionManager.java`;
const second = `${directory}/ElectionManagerTester.java`;

test.describe('touch file activation', () => {
	test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
	test('double tapping a file pins it before the mobile explorer closes', async ({ page }) => {
		await page.goto(first);
		await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
		const file = page.getByRole('region', { name: 'Course files' }).locator(`a[href="${second}"]`);
		await file.tap();
		await file.tap();
		await expect(page).toHaveURL(second);
		await expect(
			page
				.getByRole('navigation', { name: 'Open files' })
				.getByRole('link', { name: 'ElectionManagerTester.java', exact: true })
		).not.toHaveClass(/italic/);
	});
});

test('single explorer clicks preview and double clicks pin across navigation', async ({ page }) => {
	await page.goto(first);
	const explorer = page.getByRole('region', { name: 'Course files' });
	const tabs = page.getByRole('navigation', { name: 'Open files' });
	await explorer.locator(`a[href="${second}"]`).click();
	await expect(page).toHaveURL(second);
	await expect(tabs.getByRole('link')).toHaveCount(1);
	await expect(tabs.getByRole('link')).toHaveClass(/italic/);
	await explorer.locator(`a[href="${first}"]`).dblclick();
	expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
	await expect(page).toHaveURL(first);
	await expect(
		tabs.getByRole('link', { name: 'ElectionManager.java', exact: true })
	).not.toHaveClass(/italic/);
	await explorer.locator(`a[href="${second}"]`).click();
	await expect(tabs.getByRole('link')).toHaveCount(2);
	await expect(
		tabs.getByRole('link', { name: 'ElectionManager.java', exact: true })
	).not.toHaveClass(/italic/);
});

test('pinning immediately after opening a file survives reload', async ({ page }) => {
	await page.goto(first);
	await page.getByRole('button', { name: 'Keep file open' }).click();
	await page.reload();
	await expect(
		page.getByRole('navigation', { name: 'Open files' }).getByRole('link')
	).not.toHaveClass(/italic/);
	await expect(page.getByRole('button', { name: 'Keep file open' })).toHaveCount(0);
});

test('file tabs preview, pin, restore scrolling, survive reload, and close predictably', async ({
	page
}) => {
	await page.goto(first);
	const tabs = page.getByRole('navigation', { name: 'Open files' });
	const explorer = page.getByRole('region', { name: 'Course files' });
	await expect(tabs.getByRole('link')).toHaveCount(1);
	await explorer.locator(`a[href="${second}"]`).click();
	await expect(page).toHaveURL(second);
	await expect(tabs.getByRole('link')).toHaveCount(1);
	const tester = tabs.getByRole('link', { name: 'ElectionManagerTester.java', exact: true });
	await expect(tester).toHaveClass(/italic/);
	await tester.dblclick();
	expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
	await expect(tester).not.toHaveClass(/italic/);
	await explorer.locator(`a[href="${first}"]`).click();
	await expect(page).toHaveURL(first);
	await expect(tabs.getByRole('link')).toHaveCount(2);
	await page.getByRole('button', { name: 'Keep file open' }).click();
	const viewport = page.locator('.file-content');
	await viewport.evaluate((node) => {
		node.scrollTop = 600;
	});
	await tester.click();
	await expect(page).toHaveURL(second);
	await page.goBack();
	await expect(page).toHaveURL(first);
	await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBe(600);
	await page.reload();
	await expect(tabs.getByRole('link')).toHaveCount(2);
	await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBe(600);
	const saved = await page.evaluate(() =>
		JSON.parse(sessionStorage.getItem('wisconsin-file-tabs')!)
	);
	for (const tab of saved)
		expect(Object.keys(tab).sort()).toEqual(['course', 'left', 'path', 'pinned', 'top']);
	await page.setViewportSize({ width: 390, height: 844 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
	await tabs.getByRole('button', { name: 'Close ElectionManagerTester.java', exact: true }).click();
	await expect(page).toHaveURL(first);
	await expect(tabs.getByRole('link')).toHaveCount(1);
	await tabs.getByRole('button', { name: 'Close ElectionManager.java', exact: true }).click();
	await expect(page).toHaveURL('/fa24-cs300/files');
	await expect(tabs.getByRole('link')).toHaveCount(0);
});
