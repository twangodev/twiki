import { expect, test } from '@playwright/test';

const directory = '/fa24-cs300/files/p01/src/main/java';
const first = `${directory}/ElectionManager.java`;
const second = `${directory}/ElectionManagerTester.java`;

test.describe('touch tab reordering', () => {
	test.use({ hasTouch: true, viewport: { width: 1440, height: 900 } });
	test('touch capture transfers to the strip without ending the drag', async ({ page }) => {
		await page.goto(first);
		await page.getByRole('button', { name: 'Keep file open' }).click();
		await page.getByRole('region', { name: 'Course files' }).locator(`a[href="${second}"]`).click();
		const links = page.getByRole('navigation', { name: 'Open files' }).getByRole('link');
		await expect(links).toHaveCount(2);
		const start = (await links.first().boundingBox())!;
		const end = (await links.last().boundingBox())!;
		const cdp = await page.context().newCDPSession(page);
		const x = start.x + start.width / 2;
		const y = start.y + start.height / 2;
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
		for (let step = 1; step <= 12; step++) {
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: [{ x: x + ((end.x + end.width / 2 - x) * step) / 12, y }]
			});
		}
		await expect(page.locator('[data-drag-preview]')).toBeVisible();
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await expect(links.first()).toHaveText('ElectionManagerTester.java');
		await expect(page.locator('[data-drag-preview]')).toHaveCount(0);
		await expect(page).toHaveURL(second);
	});
});

test('one drag crosses several tabs, holds still, and reverses without losing capture', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.addInitScript(() => {
		sessionStorage.setItem(
			'wisconsin-file-tabs',
			JSON.stringify(
				[
					'p01/src/main/java/ElectionManager.java',
					'p01/src/main/java/ElectionManagerTester.java',
					'p01/README.md',
					'p01/build.gradle'
				].map((path) => ({ course: 'fa24-cs300', path, pinned: true, top: 0, left: 0 }))
			)
		);
	});
	await page.goto(first);
	const strip = page.getByRole('navigation', { name: 'Open files' });
	const links = strip.getByRole('link');
	await expect(links).toHaveCount(4);
	const start = (await links.first().boundingBox())!;
	const end = (await links.last().boundingBox())!;
	const x = start.x + start.width / 2;
	const y = start.y + start.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(end.x + end.width / 2, y, { steps: 30 });
	await expect(links.last()).toHaveText('ElectionManager.java');
	await page.waitForTimeout(300);
	await expect(links.last()).toHaveText('ElectionManager.java');
	await expect(page.locator('[data-drag-preview]')).toBeVisible();
	await page.mouse.move(x, y, { steps: 30 });
	await expect(links.first()).toHaveText('ElectionManager.java');
	await page.mouse.up();
	await expect(page.locator('[data-drag-preview]')).toHaveCount(0);
	await expect(page).toHaveURL(first);
	expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
});

test('tabs reorder by dragging and keyboard without navigating, and persist on reload', async ({
	page
}) => {
	await page.goto(first);
	await page.getByRole('button', { name: 'Keep file open' }).click();
	await page.getByRole('region', { name: 'Course files' }).locator(`a[href="${second}"]`).click();
	const tabs = page.getByRole('navigation', { name: 'Open files' });
	const source = tabs.getByRole('link', { name: 'ElectionManager.java', exact: true });
	const target = tabs.getByRole('link', { name: 'ElectionManagerTester.java', exact: true });
	const start = (await source.boundingBox())!;
	const end = (await target.boundingBox())!;
	await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
	await page.mouse.down();
	await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
	await page.mouse.up();
	await expect(tabs.getByRole('link').first()).toHaveText('ElectionManagerTester.java');
	await expect(page).toHaveURL(second);
	expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
	await page.reload();
	await expect(tabs.getByRole('link').first()).toHaveText('ElectionManagerTester.java');
	await target.focus();
	await target.press('Alt+ArrowRight');
	await expect(tabs.getByRole('link').first()).toHaveText('ElectionManager.java');
	await expect(target).toBeFocused();
	await expect(target).not.toHaveClass(/italic/);
	await expect(page).toHaveURL(second);
});

test('navigation keeps the second click on the same explorer row', async ({ page }) => {
	await page.goto(first);
	const row = page.getByRole('region', { name: 'Course files' }).locator(`a[href="${second}"]`);
	await expect(row).toBeVisible();
	await row.scrollIntoViewIfNeeded();
	const bounds = (await row.boundingBox())!;
	const point = { x: bounds.x + 40, y: bounds.y + 12 };
	await page.mouse.click(point.x, point.y);
	await page.waitForTimeout(120);
	expect(
		await page.evaluate(
			({ x, y }) => document.elementFromPoint(x, y)?.closest('a')?.getAttribute('href'),
			point
		)
	).toBe(second);
	await page.mouse.click(point.x, point.y, { clickCount: 2 });
	await expect(
		page.getByRole('navigation', { name: 'Open files' }).getByRole('link')
	).not.toHaveClass(/italic/);
	expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
});

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
