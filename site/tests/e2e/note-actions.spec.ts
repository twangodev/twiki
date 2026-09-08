import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { ContentManifest } from '../../src/lib/types';
import { textExportUrl } from '../../src/lib/text-exports';

const manifest: ContentManifest = JSON.parse(
	readFileSync('.generated/content-manifest.json', 'utf8')
);
const note = Object.values(manifest.pages).find(
	(page) => page.publication.public && page.slug !== 'index'
)!;
const noteRoute = '/' + note.slug.replace(/\/index$/, '');

test('actions stay hidden until hover and dismiss with Escape', async ({ page }) => {
	await page.goto(noteRoute);
	const trigger = page.getByRole('button', { name: 'Use this note' });
	await expect(page.getByRole('button', { name: 'Copy Markdown', exact: true })).toBeHidden();
	await trigger.hover();
	await expect(page.getByRole('dialog', { name: 'Note actions' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Copy Markdown', exact: true })).toBeEnabled();
	await page.getByRole('button', { name: 'Copy Markdown', exact: true }).hover();
	await expect(page.getByRole('dialog', { name: 'Note actions' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog', { name: 'Note actions' })).toBeHidden();
	await page.screenshot({ path: '/tmp/wisconsin-actions-collapsed.png' });
});

test('note actions copy the complete Markdown export', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.goto(noteRoute);
	await page.getByRole('button', { name: 'Use this note' }).click();
	await page.getByRole('button', { name: 'Copy Markdown', exact: true }).click();
	await expect(page.getByRole('status')).toContainText('Markdown copied.');
	const expected = await (await page.request.get(textExportUrl(note.slug))).text();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
});

for (const format of ['md', 'txt'] as const) {
	test(`${format} links bypass Svelte page routing`, async ({ page }) => {
		const dataRequests: string[] = [];
		page.on('request', (request) => {
			if (/\.(?:md|txt)\/__data\.json/.test(request.url())) dataRequests.push(request.url());
		});
		await page.goto(noteRoute);
		await page.getByRole('button', { name: 'Use this note' }).click();
		const exportPath = textExportUrl(note.slug, format);
		const responsePromise = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === exportPath && response.request().isNavigationRequest()
		);
		await page
			.getByRole('link', {
				name: format === 'md' ? 'View Markdown .md' : 'View text .txt',
				exact: true
			})
			.click();
		const response = await responsePromise;
		expect(response.ok()).toBe(true);
		expect(response.headers()['content-type']).toContain(
			format === 'md' ? 'text/markdown' : 'text/plain'
		);
		if (format === 'txt') {
			await expect(page).toHaveURL(exportPath);
			await expect(page.locator('body')).toContainText('Source: https://wisconsin.twango.dev/');
		}
		expect(dataRequests).toEqual([]);
	});
}

test('keyboard and touch users can open the actions without hover', async ({
	page,
	browser,
	baseURL
}) => {
	await page.goto(noteRoute);
	const trigger = page.getByRole('button', { name: 'Use this note' });
	await trigger.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('dialog', { name: 'Note actions' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(trigger).toBeFocused();
	const mobile = await browser.newContext({
		baseURL,
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
		storageState: { cookies: [], origins: [] }
	});
	try {
		const mobilePage = await mobile.newPage();
		await mobilePage.goto(noteRoute);
		await mobilePage.getByRole('button', { name: 'Use this note' }).tap();
		const menu = mobilePage.getByRole('dialog', { name: 'Note actions' });
		await expect(menu).toBeVisible();
		const bounds = await menu.boundingBox();
		expect(bounds!.x).toBeGreaterThanOrEqual(0);
		expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
		await mobilePage.screenshot({ path: '/tmp/wisconsin-actions-mobile.png' });
	} finally {
		await mobile.close();
	}
});

test('clipboard rejection offers manual copying', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator.clipboard, 'writeText', {
			value: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
		});
	});
	await page.goto(noteRoute);
	await page.getByRole('button', { name: 'Use this note' }).click();
	await page.getByRole('button', { name: 'Copy Markdown', exact: true }).click();
	await expect(page.getByRole('status')).toContainText('Could not copy.');
});
