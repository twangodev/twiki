import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { ContentManifest } from '../../src/lib/types';
import { textExportUrl } from '../../src/lib/text-exports';

const manifest: ContentManifest = JSON.parse(
	readFileSync('build/generated/content-manifest.json', 'utf8')
);
const pages = Object.values(manifest.pages);

test('text exports preserve the publication boundary', async ({ browser, baseURL, request }) => {
	const anonymous = await browser.newContext({
		baseURL,
		storageState: { cookies: [], origins: [] }
	});
	try {
		const publicPage = pages.find((page) => page.publication.public)!;
		const privatePage = pages.find((page) => !page.publication.public)!;
		const index = await anonymous.request.get('/llms.txt');
		expect(index.ok()).toBe(true);
		const text = await index.text();
		expect(text).toContain(textExportUrl(publicPage.slug));
		expect(text).not.toContain(textExportUrl(privatePage.slug));
		for (const format of ['md', 'txt'] as const) {
			const pageRoute = '/' + publicPage.slug.replace(/\/index$/, '');
			const published = await anonymous.request.get(`${pageRoute}.${format}`);
			expect(published.ok()).toBe(true);
			expect(await published.text()).toContain('Source: https://wisconsin.twango.dev/');
			const locked = await anonymous.request.get(textExportUrl(privatePage.slug, format));
			expect(locked.status()).toBe(401);
			const authorized = await request.get(textExportUrl(privatePage.slug, format));
			expect(authorized.ok()).toBe(true);
			expect(await authorized.text()).toContain('Source: https://wisconsin.twango.dev/');
			const folder = pages.find((page) => page.slug.endsWith('/index'))!;
			const folderRoute = '/' + folder.slug.slice(0, -'/index'.length);
			const folderExport = await request.get(`${folderRoute}.${format}`);
			expect(folderExport.ok()).toBe(true);
			expect(await folderExport.text()).toContain(
				`Source: https://wisconsin.twango.dev${folderRoute}`
			);
		}
	} finally {
		await anonymous.close();
	}
});
