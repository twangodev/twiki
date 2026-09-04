import { expect, test } from '@playwright/test';

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
	test(`graph expands its existing canvas and preserves zoom (${reducedMotion})`, async ({
		page
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.emulateMedia({ reducedMotion });
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.goto('/sp26-cs544/README');
		const graph = page.getByRole('img', { name: 'Knowledge graph' });
		await expect(graph).toHaveAttribute('data-graph-ready', 'true');
		const canvas = graph.locator('canvas');
		const original = await canvas.elementHandle();
		await canvas.dispatchEvent('wheel', { deltaY: -150, ctrlKey: true });
		const zoom = await canvas.evaluate(
			(el) => (el as HTMLCanvasElement & { __zoom: { k: number } }).__zoom.k
		);
		expect(zoom).toBeGreaterThan(1);
		const nodeCount = await graph.getAttribute('data-graph-nodes');
		await page.getByRole('button', { name: 'Expand graph' }).click();
		const fullscreen = page.getByRole('dialog', { name: 'Graph canvas' });
		await expect(fullscreen).toBeVisible();
		await expect.poll(async () => Math.round((await canvas.boundingBox())!.width)).toBe(1440);
		expect(await canvas.evaluate((el, original) => el === original, original)).toBe(true);
		expect(
			await canvas.evaluate((el) => (el as HTMLCanvasElement & { __zoom: { k: number } }).__zoom.k)
		).toBeCloseTo(zoom);
		await expect(graph).toHaveAttribute('data-graph-nodes', nodeCount!);
		await expect(fullscreen.getByRole('button', { name: 'Local', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await page.keyboard.press('Escape');
		await expect(fullscreen).toHaveCount(0);
		expect(await canvas.evaluate((el, original) => el === original, original)).toBe(true);
		await expect.poll(async () => Math.round((await canvas.boundingBox())!.height)).toBe(250);
		await expect(page.getByRole('button', { name: 'Expand graph' })).toBeFocused();
		expect(errors).toEqual([]);
	});
}

test('fullscreen graph switches scope and resizes without losing its canvas', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/sp26-cs544/README');
	await page.getByRole('button', { name: 'Expand graph' }).click();
	const fullscreen = page.getByRole('dialog');
	await fullscreen.getByRole('button', { name: 'Global', exact: true }).click();
	const graph = fullscreen.getByRole('img', { name: 'Knowledge graph' });
	await expect
		.poll(async () => Number(await graph.getAttribute('data-graph-nodes')))
		.toBeGreaterThan(500);
	const original = await graph.locator('canvas').elementHandle();
	await page.setViewportSize({ width: 1000, height: 700 });
	await expect
		.poll(async () => Math.round((await graph.locator('canvas').boundingBox())!.width))
		.toBe(1000);
	expect(await graph.locator('canvas').evaluate((el, original) => el === original, original)).toBe(
		true
	);
	await fullscreen.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(fullscreen).toHaveCount(0);
	await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden');
});
test('graph and outline share the preview height token', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/sp26-cs544/README');
	await expect(page.getByRole('img', { name: 'Knowledge graph' })).toHaveAttribute(
		'data-graph-ready',
		'true'
	);
	await page.evaluate(() => {
		document.documentElement.style.setProperty('--graph-preview-height', '280px');
	});
	await expect(page.locator('[data-graph-outer]')).toHaveCSS('height', '280px');
	await expect(page.locator('[data-graph-outer] dialog')).toHaveCSS('height', '280px');
	await expect(page.locator('.doc-toc')).toHaveCSS('max-height', '620px');
	await expect(page.locator('[data-graph-outer] canvas')).toHaveCSS('height', '280px');
});
