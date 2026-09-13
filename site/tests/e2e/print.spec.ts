import { expect, test } from '@playwright/test';

test('note print prepares a readable PDF and restores the screen layout', async ({
	page
}, testInfo) => {
	await page.goto('/fa26-cs759/lectures/lecture-03');
	const article = page.locator('article');
	await expect(article.locator('h1')).toBeVisible();
	await page.evaluate(() => {
		window.print = () => document.body.setAttribute('data-print-called', 'true');
		document.documentElement.classList.add('dark');
	});
	await page.getByRole('button', { name: 'Print / PDF' }).click();
	await expect(page.locator('body')).toHaveAttribute('data-print-called', 'true');
	await expect(page.getByRole('button', { name: 'Print / PDF' })).toBeEnabled();
	await page.emulateMedia({ media: 'print' });
	await expect(page.locator('.doc-sidebar-left')).toBeHidden();
	await expect(page.locator('.doc-sidebar-right')).toBeHidden();
	await expect(page.locator('.note-actions')).toBeHidden();
	await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
	await expect(article.locator('h1')).toHaveCSS('color', 'rgb(17, 17, 17)');
	const code = article.locator('pre.shiki').first();
	await expect(code).toHaveCSS('white-space', 'pre-wrap');
	await expect(code).toHaveCSS('overflow-x', 'visible');
	await expect(code.locator('span').first()).toHaveCSS('color', 'rgb(17, 17, 17)');
	await page.pdf({ path: testInfo.outputPath('note.pdf'), format: 'A4' });
	await page.screenshot({ path: testInfo.outputPath('print.png'), fullPage: true });
	await page.emulateMedia({ media: 'screen' });
	await expect(page.getByRole('button', { name: 'Print / PDF' })).toBeVisible();
});

test('print loads diagrams below the viewport before opening the dialog', async ({ page }) => {
	await page.goto('/sp26-cs544/lectures/lecture-25');
	await page.evaluate(() => {
		window.print = () => document.body.setAttribute('data-print-called', 'true');
	});
	const count = await page.locator('pre > code.mermaid').count();
	expect(count).toBeGreaterThan(0);
	await page.getByRole('button', { name: 'Print / PDF' }).click();
	await expect(page.locator('body')).toHaveAttribute('data-print-called', 'true', {
		timeout: 30_000
	});
	await expect(page.locator('.mermaid-inline-content > svg')).toHaveCount(count);
});
