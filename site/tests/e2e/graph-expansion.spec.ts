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

test('fullscreen graph switches scope and resizes without losing its canvas', async ({
	page,
	request
}) => {
	// Animation/zoom continuity is covered above in both motion modes. Keep this
	// test focused on the asynchronous global render and responsive resize.
	test.setTimeout(60_000);
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.setViewportSize({ width: 1440, height: 900 });
	const data: { nodes: { id: string; tags: string[] }[] } = await (
		await request.get('/graph.json')
	).json();
	const globalNodes = new Set(
		data.nodes.flatMap((node) => [node.id, ...node.tags.map((tag) => `tags/${tag}`)])
	);
	await page.goto('/sp26-cs544/README');
	const graph = page.getByRole('img', { name: 'Knowledge graph' });
	await expect(graph).toHaveAttribute('data-graph-ready', 'true', { timeout: 20_000 });
	await page.getByRole('button', { name: 'Expand graph' }).click();
	const fullscreen = page.getByRole('dialog', { name: 'Graph canvas' });
	await expect(fullscreen).toBeVisible();
	await fullscreen.getByRole('button', { name: 'Global', exact: true }).click();
	await expect(fullscreen.getByRole('button', { name: 'Global', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	// The count changes only once the new renderer has drawn its first frame.
	await expect(graph).toHaveAttribute('data-graph-nodes', String(globalNodes.size), {
		timeout: 20_000
	});
	await expect(graph).toHaveAttribute('data-graph-ready', 'true');
	const canvas = graph.locator('canvas');
	await expect(canvas).toHaveCount(1);
	const original = await canvas.elementHandle();
	await page.setViewportSize({ width: 1000, height: 700 });
	await expect
		.poll(async () => Math.round((await canvas.boundingBox())!.width), { timeout: 10_000 })
		.toBe(1000);
	expect(await canvas.evaluate((el, original) => el === original, original)).toBe(true);
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
