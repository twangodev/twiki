import { expect, test } from '@playwright/test';

const route = '/fa26-cs759/lectures/lecture-03';

test('note images open, zoom, close, and restore keyboard focus', async ({ page }) => {
	await page.goto(route);
	const trigger = page.locator('article a.image-preview').first();
	await expect(trigger).toBeVisible();
	await expect(trigger.locator('img')).toHaveJSProperty('complete', true);
	await trigger.focus();
	await page.keyboard.press('Enter');
	const viewer = page.locator('.pswp');
	await expect(viewer).toBeVisible();
	await expect(viewer.locator('.pswp__img').first()).toBeVisible();
	await expect(viewer).toHaveAttribute('role', 'dialog');
	await page.screenshot({ path: '/tmp/image-preview-desktop.png' });
	await page.getByRole('button', { name: 'Zoom', exact: true }).click();
	await expect(viewer).toHaveClass(/pswp--zoomed-in/);
	await page.keyboard.press('Escape');
	await expect(viewer).toHaveCount(0);
	await expect(trigger).toBeFocused();
	await trigger.click();
	await expect(viewer).toBeVisible();
	await page.getByRole('button', { name: 'Close' }).click();
	await expect(viewer).toHaveCount(0);
	await expect(page).toHaveURL(route);
});

test('touch users can open and dismiss a full-window image', async ({ browser, baseURL }) => {
	const context = await browser.newContext({
		baseURL,
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
		storageState: 'build/generated/auth-state.json'
	});
	try {
		const page = await context.newPage();
		await page.goto(route);
		const trigger = page.locator('article a.image-preview').first();
		await expect(trigger.locator('img')).toHaveJSProperty('complete', true);
		await trigger.tap();
		const viewer = page.locator('.pswp');
		await expect(viewer).toBeVisible();
		const bounds = await viewer.boundingBox();
		expect(bounds?.width).toBe(390);
		expect(bounds?.height).toBe(844);
		await page.getByRole('button', { name: 'Close' }).tap();
		await expect(viewer).toHaveCount(0);
	} finally {
		await context.close();
	}
});

for (const action of ['close', 'zoom', 'Escape'] as const) {
	test(`opening animates from the thumbnail and preserves an early ${action}`, async ({ page }) => {
		await page.goto(route);
		const trigger = page.locator('article a.image-preview').first();
		await trigger.scrollIntoViewIfNeeded();
		await expect(trigger.locator('img')).toHaveJSProperty('complete', true);
		const evidence = await page.evaluate(async (action) => {
			return await new Promise<{ transition: string; width: number }>((resolve) => {
				const observer = new MutationObserver(() => {
					const viewer = document.querySelector('.pswp');
					const zoom = viewer?.querySelector<HTMLElement>('.pswp__zoom-wrap');
					if (!zoom?.style.transition.includes('transform')) return;
					observer.disconnect();
					const width = document
						.querySelector('article a.image-preview img')!
						.getBoundingClientRect().width;
					if (action === 'Escape')
						document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
					else viewer?.querySelector<HTMLButtonElement>(`.pswp__button--${action}`)?.click();
					resolve({ transition: zoom.style.transition, width });
				});
				observer.observe(document.body, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: ['style']
				});
				document.querySelector<HTMLAnchorElement>('article a.image-preview')!.click();
			});
		}, action);
		expect(evidence.transition).toContain('250ms');
		if (action === 'zoom') {
			await expect(page.locator('.pswp')).toHaveClass(/pswp--zoomed-in/);
			await expect
				.poll(async () => (await page.locator('.pswp__img').first().boundingBox())!.width)
				.toBeGreaterThan(evidence.width * 1.5);
			await page.keyboard.press('Escape');
		}
		await expect(page.locator('.pswp')).toHaveCount(0);
	});
}
