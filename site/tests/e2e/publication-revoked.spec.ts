import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import type { CourseFile } from '../../src/lib/files';

test.skip(process.env.PUBLICATION_TEST !== 'revoked', 'Uses the revoked publication fixture');

test('removing publication rules closes old pages, data, files and derivatives after a rebuild', async ({
	browser,
	baseURL,
	request
}) => {
	expect(JSON.parse(readFileSync('.generated/public-assets.json', 'utf8'))).toEqual({});
	expect(existsSync('.svelte-kit/cloudflare/_published')).toBe(false);
	const anonymous = await browser.newContext({
		baseURL,
		storageState: { cookies: [], origins: [] }
	});
	try {
		const files: CourseFile[] = await (await request.get('/_files/index/sp99-cs101.json')).json();
		const download = files.find((file) => file.path === 'p01/Main.java')!.download!;
		for (const url of [
			'/',
			'/sp99-cs101',
			'/sp99-cs101/notes/public',
			'/sp99-cs101/notes/public/__data.json',
			'/sp99-cs101/files/p01/Main.java',
			'/_files/index/sp99-cs101.json',
			download,
			'/graph.json',
			'/pagefind/pagefind.js',
			'/sitemap.xml'
		]) {
			expect((await request.get(url)).status()).toBe(200);
			for (const method of ['GET', 'HEAD']) {
				const response = await anonymous.request.fetch(url, { method, maxRedirects: 0 });
				expect(response.status()).toBe(401);
				expect(response.headers()['cache-control']).toBe('private, no-store');
			}
		}
	} finally {
		await anonymous.close();
	}
});
