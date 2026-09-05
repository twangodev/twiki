import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { ContentManifest } from '../../src/lib/types';

test('note visibility matches generated publication metadata', async ({ page }) => {
	const manifest: ContentManifest = JSON.parse(
		readFileSync('.generated/content-manifest.json', 'utf8')
	);
	const note = Object.values(manifest.pages).find((note) => note.slug !== 'index')!;
	const route = '/' + (note.slug.endsWith('/index') ? note.slug.slice(0, -6) : note.slug);
	await page.goto(route);
	const badge = page.getByLabel(
		`Page visibility: ${note.publication.public ? 'Public' : 'Private'}`
	);
	await expect(badge).toBeVisible();
	await expect(page.getByRole('link', { name: 'Manage access' })).toBeVisible();
	await badge.focus();
	await expect(page.getByRole('tooltip')).toHaveText(note.publication.reason!);
});
