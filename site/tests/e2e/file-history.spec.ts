import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { CourseFile } from '../../src/lib/files';
import type { FileHistory } from '../../src/lib/file-history';

const course = 'fa24-cs300';
const filename = 'p01/src/main/java/ElectionManager.java';
const route = `/${course}/files/${filename}`;
const files: CourseFile[] = JSON.parse(readFileSync(`static/_files/index/${course}.json`, 'utf8'));
const file = files.find((file) => file.path === filename)!;
const history: FileHistory = JSON.parse(readFileSync(`static${file.history}`, 'utf8'));

test('history and blame load on demand, diffs stay read-only, and closing returns to the file', async ({
	page
}) => {
	const requests: string[] = [];
	page.on('request', (request) => {
		if (request.url().includes('/_files/history/')) requests.push(request.url());
	});
	await page.goto(route);
	await expect(page.locator('.cm-content')).toBeVisible();
	expect(requests).toHaveLength(0);
	await page.getByRole('button', { name: 'Toggle blame', exact: true }).click();
	await expect(page.locator('.file-blame-line').first()).toBeVisible();
	const row = await page.locator('.cm-content .cm-line').first().boundingBox();
	const marker = await page.locator('.file-blame-line').first().boundingBox();
	expect(Math.abs(row!.y - marker!.y)).toBeLessThan(2);
	await page.getByRole('button', { name: 'File history', exact: true }).click();
	const panel = page.getByRole('complementary', { name: 'File history' });
	await expect(panel.locator('ol button')).toHaveCount(history.commits.length);
	await panel
		.locator('ol button')
		.nth(history.commits.findIndex((commit) => commit.diff))
		.click();
	await expect(page.getByRole('button', { name: 'Back to file' })).toBeVisible();
	await expect(page.locator('.cm-line').first()).toContainText('diff --git');
	await expect(page.locator('.cm-content')).not.toHaveAttribute('contenteditable', 'true');
	await page.getByRole('button', { name: 'Back to file' }).click();
	await expect(page.locator('.file-blame-line').first()).toBeVisible();
	await page.getByRole('button', { name: 'Close history' }).click();
	await expect(panel).toHaveCount(0);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole('button', { name: 'File history', exact: true }).click();
	await expect(panel).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('full-file search reaches lines beyond the old preview cap without rendering every line', async ({
	page
}) => {
	await page.goto('/fa25-cs354/files/p1/decode.i');
	const code = page.locator('.cm-content');
	await expect(code).toBeVisible();
	expect(await page.locator('.cm-line').count()).toBeLessThan(300);
	await code.focus();
	await page.keyboard.press('Control+f');
	await page.locator('.cm-search input[name="search"]').pressSequentially('return shifts;');
	await page.locator('.cm-search input[name="search"]').press('Enter');
	await expect(page.locator('.cm-line').filter({ hasText: 'return shifts;' })).toBeVisible();
	await expect(page.locator('footer').last()).toContainText('2388 lines');
	await expect(page.getByText('Showing a limited preview.')).toHaveCount(0);
});

test('history, blame and diffs remain gated for anonymous requests after warming', async ({
	request,
	browser,
	baseURL
}) => {
	const anonymous = await browser.newContext({
		baseURL,
		storageState: { cookies: [], origins: [] }
	});
	try {
		for (const url of [
			file.history!,
			history.blame!,
			history.commits.find((commit) => commit.diff)!.diff!
		]) {
			expect((await request.get(url)).status()).toBe(200);
			for (const method of ['GET', 'HEAD']) {
				const response = await anonymous.request.fetch(url, { method });
				expect(response.status()).toBe(401);
				expect(response.headers()['cache-control']).toBe('private, no-store');
			}
		}
	} finally {
		await anonymous.close();
	}
});
