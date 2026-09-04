import { expect, test } from '@playwright/test';

for (const platform of ['MacIntel', 'Linux x86_64']) {
	test(`search shortcut renders the platform modifier accessibly (${platform})`, async ({
		page
	}) => {
		await page.addInitScript((platform) => {
			Object.defineProperty(navigator, 'platform', { value: platform });
		}, platform);
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto('/');
		const button = page.locator('.doc-sidebar-left').getByRole('button', {
			name: platform === 'MacIntel' ? 'Search Command K' : 'Search Ctrl K'
		});
		await expect(button).toBeVisible();
		await expect(button.locator('kbd svg')).toHaveCount(platform === 'MacIntel' ? 1 : 0);
		await expect(button.locator('kbd')).not.toContainText('⌘');
		await button.click();
		await expect(page.getByPlaceholder('Search… or #tag')).toBeVisible();
	});
}
