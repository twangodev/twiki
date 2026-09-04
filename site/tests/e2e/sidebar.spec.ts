import { expect, test } from '@playwright/test';

test('mobile course switcher supports keyboard selection with reduced motion', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto('/sp26-cs544/README');
	const toggle = page.getByRole('button', { name: 'Toggle navigation' });
	await toggle.click();
	const rail = page.locator('.doc-sidebar-left');
	await rail.getByRole('button', { name: 'Spring 2026 CS 544' }).click();
	const search = rail.getByRole('textbox', { name: 'Find a course' });
	await search.fill('CS 537');
	await search.press('Tab');
	await expect(rail.getByRole('link', { name: 'CS 537', exact: true })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/\/sp26-cs537\/README$/);
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('course navigator switches courses and preserves manually opened branches', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 800 });
	await page.goto('/sp26-cs544/README');
	const rail = page.locator('.doc-sidebar-left');
	const nav = rail.getByRole('navigation', { name: 'Documentation' });
	await expect(rail.getByRole('button', { name: 'Spring 2026 CS 544' })).toBeVisible();
	await expect(nav.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(nav.locator('a[href^="/sp26-cs537"]')).toHaveCount(0);
	const lectures = nav.getByRole('button', { name: 'Toggle Lectures', exact: true });
	await lectures.click();
	await nav.locator('a[href="/sp26-cs544/lectures/lecture-01"]').click();
	await expect(lectures).toHaveAttribute('aria-expanded', 'true');
	await nav.getByRole('link', { name: 'Overview', exact: true }).click();
	await expect(lectures).toHaveAttribute('aria-expanded', 'true');
	await rail.getByRole('button', { name: 'Spring 2026 CS 544' }).click();
	const search = rail.getByRole('textbox', { name: 'Find a course' });
	await expect(search).toBeFocused();
	await search.fill('537');
	await expect(nav.getByRole('link', { name: 'CS 544', exact: true })).toHaveCount(0);
	await nav.getByRole('link', { name: 'CS 537', exact: true }).click();
	await expect(page).toHaveURL(/\/sp26-cs537\/README$/);
	await expect(rail.getByRole('button', { name: 'Spring 2026 CS 537' })).toBeVisible();
	await rail.getByRole('button', { name: 'Spring 2026 CS 537' }).click();
	await search.fill('544');
	await nav.getByRole('link', { name: 'CS 544', exact: true }).click();
	await expect(lectures).toHaveAttribute('aria-expanded', 'true');
	await rail.getByRole('button', { name: 'Spring 2026 CS 544' }).click();
	await search.fill('nothing-matches');
	await expect(nav).toContainText('No courses match');
	await search.press('Escape');
	await expect(rail.getByRole('button', { name: 'Spring 2026 CS 544' })).toBeFocused();
});

test('course navigator reveals deep pages without following article scrolling', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 600 });
	await page.goto('/sp26-cs639/lectures/lecture-15');
	const nav = page.locator('.doc-sidebar-left nav');
	const active = nav.locator('[aria-current="page"]');
	await expect(active).toHaveAttribute('href', '/sp26-cs639/lectures/lecture-15');
	await expect
		.poll(async () => {
			const bounds = (await nav.boundingBox())!,
				row = (await active.boundingBox())!;
			return row.y >= bounds.y && row.y + row.height <= bounds.y + bounds.height;
		})
		.toBe(true);
	await nav.evaluate((element) => {
		element.scrollTop = 0;
	});
	await page.evaluate(() => window.scrollTo(0, 500));
	await page.waitForTimeout(300);
	expect(await nav.evaluate((element) => element.scrollTop)).toBe(0);
});
