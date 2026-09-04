import { expect, test } from '@playwright/test';

test('active outline row follows reading within its own scroll viewport', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 600 });
	await page.goto('/');
	const toc = page.locator('.doc-toc');
	await toc.getByRole('button', { name: 'Expand all', exact: true }).click();
	for (const id of ['deployment', 'bonus-features']) {
		const articleScroll = await page.evaluate((id) => {
			window.scrollTo({
				top: window.scrollY + document.getElementById(id)!.getBoundingClientRect().top - 100,
				behavior: 'instant'
			});
			return window.scrollY;
		}, id);
		const active = toc.locator(`a[href="#${id}"]`);
		await expect(active).toHaveAttribute('aria-current', 'location');
		await expect
			.poll(async () => {
				const bounds = (await toc.boundingBox())!;
				const row = (await active.boundingBox())!;
				return row.y >= bounds.y && row.y + row.height <= bounds.y + bounds.height;
			})
			.toBe(true);
		expect(await page.evaluate(() => window.scrollY)).toBe(articleScroll);
		await expect
			.poll(async () => {
				const bounds = (await toc.boundingBox())!;
				const marker = (await toc.locator('.position-marker').boundingBox())!;
				return marker.y >= bounds.y && marker.y + marker.height <= bounds.y + bounds.height;
			})
			.toBe(true);
	}
	await expect(page.locator('[data-graph-outer]')).toBeInViewport();
});

test('deep headings remain reachable without an ever-widening indent', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/sp26-cs544/debugging-autobadger');
	const toc = page.locator('.doc-toc nav');
	await toc.getByRole('button', { name: 'Expand all', exact: true }).click();
	const heading = page.locator('article h6').first();
	const id = await heading.getAttribute('id');
	expect(id).toBeTruthy();
	const link = toc.locator(`a[href="#${id}"]`);
	await expect(link).toBeVisible();
	const nestedGuides = await link.evaluate((element) => {
		let count = 0;
		for (let parent = element.parentElement; parent; parent = parent.parentElement) {
			if (parent.matches('ul.nested')) count++;
		}
		return count;
	});
	expect(nestedGuides).toBeLessThanOrEqual(2);
	await link.click();
	await expect(page).toHaveURL(new RegExp(`#${id}$`));

	await page.goto('/fa25-anthro105/lectures/lecture-6');
	await toc.getByRole('button', { name: 'Expand all', exact: true }).click();
	const deepest = toc.getByRole('link', { name: 'Genetic Structure', exact: true });
	await expect(deepest).toBeVisible();
	await expect(toc.locator('.parent-context').first()).toContainText('Key Terminology');
	expect(
		await deepest.evaluate((element) => {
			let count = 0;
			for (let parent = element.parentElement; parent; parent = parent.parentElement) {
				if (parent.matches('ul.nested')) count++;
			}
			return count;
		})
	).toBe(2);
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
	test(`focus outline follows reading and preserves manual branches (${reducedMotion})`, async ({
		page
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.emulateMedia({ reducedMotion });
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.goto('/');
		const toc = page.locator('.doc-toc nav');
		const technical = toc.getByRole('button', {
			name: 'Toggle A Technical Glance sections',
			exact: true
		});
		const quick = toc.getByRole('button', { name: 'Toggle Quick Start sections', exact: true });
		await expect(technical).toHaveAttribute('aria-expanded', 'false');
		await expect(toc.getByRole('link', { name: 'Bonus Features', exact: true })).toHaveCount(0);

		async function readSection(id: string) {
			await page.evaluate((id) => {
				const heading = document.getElementById(id)!;
				window.scrollTo({
					top: window.scrollY + heading.getBoundingClientRect().top - 100,
					behavior: 'instant'
				});
			}, id);
			await expect(toc.locator('a[aria-current="location"]')).toHaveAttribute('href', `#${id}`);
		}
		await readSection('bonus-features');
		await expect(technical).toHaveAttribute('aria-expanded', 'true');
		await readSection('development');
		await expect(technical).toHaveAttribute('aria-expanded', 'false');
		await expect(quick).toHaveAttribute('aria-expanded', 'true');
		await toc.getByRole('link', { name: 'Development', exact: true }).focus();
		await readSection('clone-the-repository');
		await expect(quick).toHaveAttribute('aria-expanded', 'true');
		await expect(toc.getByRole('link', { name: 'Development', exact: true })).toBeFocused();
		await technical.click();
		await readSection('clone-the-repository');
		await expect(technical).toHaveAttribute('aria-expanded', 'true');
		await expect(quick).toHaveAttribute('aria-expanded', 'false');

		await toc.getByRole('button', { name: 'Expand all', exact: true }).click();
		await expect(toc.getByRole('link', { name: 'Development', exact: true })).toBeVisible();
		await toc.getByRole('link', { name: 'Bonus Features', exact: true }).focus();
		await readSection('development');
		await expect(toc.getByRole('link', { name: 'Bonus Features', exact: true })).toBeFocused();
		await toc.getByRole('button', { name: 'Focus', exact: true }).click();
		await expect(technical).toHaveAttribute('aria-expanded', 'false');
		await expect(quick).toHaveAttribute('aria-expanded', 'true');
		await expect(toc.locator('.position-marker')).toHaveCSS('opacity', '1');
		expect(errors).toEqual([]);
	});
}
