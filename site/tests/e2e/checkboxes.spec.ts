import { expect, test } from '@playwright/test';

test('sample-exam choices can be checked with the mouse and keyboard', async ({ page }) => {
	await page.goto('/fa26-stat324/exams/midterm-1/sample-2');
	await expect(page.locator('article input[type="checkbox"][disabled]')).toHaveCount(0);
	await expect(page.getByRole('heading', { level: 5 })).toHaveCount(7);
	const choices = page
		.getByRole('heading', { name: /^\(iii\) Vector length/ })
		.locator('xpath=following-sibling::ul[1]')
		.getByRole('checkbox');
	await expect(choices).toHaveCount(3);
	await expect(choices.nth(2)).not.toBeChecked();
	await choices.nth(2).check();
	await expect(choices.nth(2)).toBeChecked();
	await choices.nth(2).uncheck();
	await choices.first().focus();
	await page.keyboard.press('Space');
	await expect(choices.first()).toBeChecked();
	const answer = page
		.getByRole('heading', { name: /^\(iii\) Vector length/ })
		.locator('xpath=following-sibling::blockquote[1]');
	await expect(answer).toHaveClass(/is-collapsed/);
	await answer.locator('.callout-title').click();
	await expect(answer).not.toHaveClass(/is-collapsed/);
	await expect(answer.locator('.callout-content')).toContainText('(C) 100');
});
