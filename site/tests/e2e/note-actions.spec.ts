import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { ContentManifest } from '../../src/lib/types';
import { textExportUrl } from '../../src/lib/text-exports';

const manifest: ContentManifest = JSON.parse(
	readFileSync('.generated/content-manifest.json', 'utf8')
);
const pages = Object.values(manifest.pages);

test('note actions copy the complete export and open a chat', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const note = pages.find((page) => page.publication.public && page.slug !== 'index')!;
	await page.goto('/' + note.slug.replace(/\/index$/, ''));
	await page.getByRole('button', { name: 'Copy Markdown', exact: true }).click();
	await expect(page.getByRole('status')).toContainText('Markdown copied.');
	const expected = await (await page.request.get(textExportUrl(note.slug))).text();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
	// Keep the browser test local: verify the destination without calling a provider.
	await context.route('https://claude.ai/**', (route) => route.fulfill({ body: 'Claude' }));
	const popup = page.waitForEvent('popup');
	await page.getByRole('button', { name: 'Open in Claude', exact: true }).click();
	const chat = await popup;
	await expect(chat).toHaveURL('https://claude.ai/new');
	await expect(page.getByRole('status')).toContainText('Paste into Claude');
	await chat.close();
	await context.route('https://chatgpt.com/**', (route) => route.fulfill({ body: 'ChatGPT' }));
	const secondPopup = page.waitForEvent('popup');
	await page.getByRole('button', { name: 'Open in ChatGPT', exact: true }).click();
	const secondChat = await secondPopup;
	await expect(secondChat).toHaveURL('https://chatgpt.com/');
	await secondChat.close();
	await page.setViewportSize({ width: 390, height: 844 });
	await page.reload();
	await expect(page.getByRole('button', { name: 'Toggle navigation' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Copy Markdown', exact: true })).toBeVisible();
	await page.screenshot({ path: '/tmp/wisconsin-note-actions.png' });
});
