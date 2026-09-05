import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { CourseFile } from '../../src/lib/files';

test.skip(process.env.PUBLICATION_TEST !== 'true', 'Uses the isolated publication fixture');
const note = '/sp99-cs101/notes/public';
const privateNote = '/sp99-cs101/notes/slides';
const canaries = /(?:root|lecture|overview|history|answer|exam|draft)privatecanary/;

test('the public graph includes locked notes, their tags and their connections', async ({
	browser,
	baseURL,
	request
}) => {
	const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
	try {
		const graph = await (await context.request.get('/graph.json')).json();
		expect(graph).toEqual(await (await request.get('/graph.json')).json());
		expect(graph.nodes).toContainEqual({
			id: 'sp99-cs101/notes/slides',
			title: 'Private lecture slides',
			tags: ['lectures', 'systems/distributed', 'cs101']
		});
		expect(graph.links).toContainEqual({
			source: 'sp99-cs101/notes/slides',
			target: 'sp99-cs101/notes/public'
		});
		expect(graph.links).toContainEqual({
			source: 'sp99-cs101/notes/public',
			target: 'sp99-cs101/notes/slides'
		});
		expect(JSON.stringify(graph)).not.toMatch(canaries);
		const page = await context.newPage();
		await page.goto('/tags/systems/distributed');
		await expect(
			page.getByRole('link', { name: 'Private lecture slides', exact: true }).last()
		).toBeVisible();
		expect(await page.content()).not.toMatch(canaries);
		expect(await page.content()).not.toContain('Invalid Date');
		await page.getByRole('link', { name: 'Private lecture slides', exact: true }).last().click();
		await expect(page.getByText('Content locked', { exact: true })).toBeVisible();
	} finally {
		await context.close();
	}
});

test('locked previews expose titles and headings without bodies, downloads or history', async ({
	browser,
	baseURL,
	request
}) => {
	const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
	try {
		const page = await context.newPage();
		await page.goto(privateNote);
		await expect(page.getByText('Content locked', { exact: true })).toBeVisible();
		await expect(page.getByLabel('Page outline')).toContainText('Public heading outline');
		await expect(page.getByLabel('Page outline')).toContainText('Nested heading');
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
			'content',
			'noindex, nofollow'
		);
		await expect(page.getByRole('link', { name: 'Sign in to read' })).toHaveAttribute(
			'href',
			`/login?next=${encodeURIComponent(privateNote)}`
		);
		expect(await page.content()).not.toMatch(canaries);
		expect(await (await context.request.get(`${privateNote}/__data.json`)).text()).not.toMatch(
			canaries
		);
		await page.setViewportSize({ width: 390, height: 844 });
		await expect
			.poll(() =>
				page
					.locator('.doc-sidebar-left')
					.evaluate((element) => element.getBoundingClientRect().right)
			)
			.toBeLessThanOrEqual(0);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		await page.screenshot({ path: '/tmp/wisconsin-locked-note.png' });
		await page.goto('/sp99-cs101/p01/private/outline');
		await expect(page.getByText('Content locked', { exact: true })).toBeVisible();
		await expect(page.getByLabel('Page outline')).toContainText('Visible heading');
		expect(await page.content()).not.toMatch(canaries);
		await page.goto('/sp99-cs101/files/p01/private/Answer.java');
		await expect(page.getByText('Content locked', { exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Download', exact: true })).toHaveCount(0);
		await expect(page.locator('.cm-content')).toHaveCount(0);
		const full = await request.get('/sp99-cs101/files/p01/private/Answer.java/__data.json');
		expect(full.status()).toBe(200);
		expect(await full.text()).toContain('/_files/blobs/');
		const publicFiles: CourseFile[] = await (
			await context.request.get('/_files/index/sp99-cs101.json')
		).json();
		for (const file of publicFiles.filter((file) => file.locked)) {
			expect(file.download).toBeUndefined();
			expect(file.history).toBeUndefined();
		}
	} finally {
		await context.close();
	}
});

test('public output contains no private content, history, or navigation bundles', () => {
	const root = '.generated/public-site';
	for (const file of readdirSync(root, { recursive: true, withFileTypes: true })) {
		if (!file.isFile()) continue;
		const contents = readFileSync(path.join(file.parentPath, file.name)).toString();
		expect(contents, path.join(file.parentPath, file.name)).not.toMatch(canaries);
	}
	const assets = JSON.parse(readFileSync('.generated/public-assets.json', 'utf8'));
	expect(Object.keys(assets).some((url) => url.startsWith('/_files/history/'))).toBe(false);
	expect(Object.keys(assets).some((url) => url.includes('publish.yaml'))).toBe(false);
});

test('anonymous HTML, hydration, navigation, graphs and search use only the public collection', async ({
	browser,
	baseURL
}) => {
	const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
	try {
		const html = await context.request.get(note);
		expect(html.status()).toBe(200);
		expect(html.headers()['x-robots-tag']).toBeUndefined();
		expect(await html.text()).toContain('publicsearchcanary');
		expect(await html.text()).not.toMatch(canaries);
		const page = await context.newPage();
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.goto(note);
		await expect(page.getByRole('heading', { name: 'Public derivations' })).toBeVisible();
		await expect(page.getByRole('complementary', { name: 'Content license' })).toContainText(
			'Example author'
		);
		await expect(page.locator('head link[rel="license"]')).toHaveAttribute(
			'href',
			'https://creativecommons.org/licenses/by/4.0/'
		);
		await expect(page.getByLabel('Page visibility: Public')).toBeVisible();
		expect(await html.text()).not.toContain('Included by');
		await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Restricted reference' })).toHaveAttribute(
			'href',
			privateNote
		);
		await page.locator('article').getByRole('link', { name: 'Next derivation' }).click();
		await expect(page.getByRole('heading', { name: 'Second derivation' })).toBeVisible();
		const graph = await context.request.get('/graph.json');
		expect(graph.status()).toBe(200);
		expect(await graph.text()).not.toContain('secret');
		const results = await page.evaluate(async () => {
			const url = '/pagefind/pagefind.js';
			const search = await import(url);
			await search.init();
			return {
				public: (await search.search('publicsearchcanary')).results.length,
				private: (await search.search('lectureprivatecanary')).results.length
			};
		});
		expect(results.public).toBeGreaterThan(0);
		expect(results.private).toBe(0);
		await page.goto('/sp99-cs101');
		await expect(page.getByRole('heading', { name: 'sp99-cs101' })).toBeVisible();
		expect(await page.content()).not.toContain('overviewprivatecanary');
		expect(errors).toEqual([]);
	} finally {
		await context.close();
	}
});

test('signed-in readers see publication status and the source rule, not their login state', async ({
	page
}) => {
	await page.goto(note);
	const published = page.getByLabel('Page visibility: Public');
	await expect(published).toBeVisible();
	await expect(page.getByRole('link', { name: 'Manage access' })).toBeVisible();
	await published.focus();
	await expect(published).toBeFocused();
	await expect(page.getByRole('tooltip')).toHaveText(
		'sp99-cs101/publish.yaml: Included by notes/public.md'
	);
	await page.keyboard.press('Escape');
	await expect(page.getByRole('tooltip')).toHaveCount(0);
	await page.goto(privateNote);
	await expect(page.getByLabel('Page visibility: Private')).toBeVisible();
	await page.getByLabel('Page visibility: Private').focus();
	await expect(page.getByRole('tooltip')).toHaveText('sp99-cs101/publish.yaml: Not included');
	await page.goto('/');
	await expect(page.getByLabel('Page visibility: Private')).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(note);
	await expect(page.getByLabel('Page visibility: Public')).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({ path: '/tmp/wisconsin-publication-badge.png' });
});

test('public files render and download without exposing siblings or history', async ({
	browser,
	baseURL,
	request
}) => {
	const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
	try {
		const response = await context.request.get('/_files/index/sp99-cs101.json');
		expect(response.status()).toBe(200);
		const files: CourseFile[] = await response.json();
		expect(files.filter((file) => !file.locked)).toHaveLength(6);
		expect(files.every((file) => !file.history)).toBe(true);
		expect(files.find((file) => file.path === 'p01/private/Answer.java')?.locked).toBe(true);
		expect(
			files.filter((file) => file.locked).every((file) => !file.download && !file.history)
		).toBe(true);
		for (const file of files.filter((file) => !file.locked))
			expect((await context.request.get(file.download!)).status()).toBe(200);
		const page = await context.newPage();
		await page.goto('/sp99-cs101/files/p01/Main.java');
		await expect(page.locator('.cm-content')).toContainText('class Main');
		await page.getByText('CC BY 4.0 · Attribution', { exact: true }).click();
		await expect(page.getByRole('complementary', { name: 'Content license' })).toContainText(
			'Reformatted as Markdown.'
		);
		await expect(page.getByRole('button', { name: 'File history', exact: true })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Toggle blame', exact: true })).toHaveCount(0);
		await page.goto('/sp99-cs101/files/p01/R%C3%A9sum%C3%A9%20Test.java');
		await expect(page.locator('.cm-content')).toContainText('class Helper');
		const full: CourseFile[] = await (await request.get('/_files/index/sp99-cs101.json')).json();
		expect(full.length).toBe(files.length);
		const approved = full.find((file) => file.path === 'notes/public.md')!;
		const history = await (await request.get(approved.history!)).json();
		for (const url of [
			approved.history!,
			history.blame,
			...history.commits.map((commit: { diff?: string }) => commit.diff)
		].filter(Boolean)) {
			expect((await request.get(url)).status()).toBe(200);
			expect((await context.request.get(url)).status()).toBe(401);
		}
	} finally {
		await context.close();
	}
});

test('warming full content cannot leak it anonymously, including page data and generated bundles', async ({
	browser,
	baseURL,
	request
}) => {
	const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
	try {
		const full: CourseFile[] = await (await request.get('/_files/index/sp99-cs101.json')).json();
		const secret = full.find((file) => file.path === 'notes/slides.md')!;
		for (const url of [
			privateNote,
			`${privateNote}/__data.json`,
			secret.download!,
			'/sp99-cs101/files/notes/slides.md',
			'/sp99-cs101/files/notes/slides.md/__data.json'
		]) {
			expect((await request.get(url)).status()).toBe(200);
			for (const method of ['GET', 'HEAD']) {
				const response = await context.request.fetch(url, { method, maxRedirects: 0 });
				expect(response.status()).toBe(url === secret.download ? 401 : 200);
				expect(await response.text()).not.toMatch(canaries);
			}
		}
		for (const url of [
			'/_published',
			'/_published/sp99-cs101/notes/public',
			'/_published/sp99-cs101/notes/public/__data.json'
		])
			expect((await context.request.get(url)).status()).toBe(404);
		const assets: Record<string, string> = JSON.parse(
			readFileSync('.generated/public-assets.json', 'utf8')
		);
		const chunks = readdirSync('.svelte-kit/cloudflare/_app/immutable', { recursive: true })
			.filter((file) => typeof file === 'string' && file.endsWith('.js'))
			.map((file) => `/_app/immutable/${file}`);
		const privateChunks = chunks.filter((file) => !assets[file]);
		expect(privateChunks.length).toBeGreaterThan(0);
		for (const chunk of privateChunks)
			expect((await context.request.get(chunk)).status()).toBe(401);
		const data = await context.request.get(`${note}/__data.json`);
		expect(data.status()).toBe(200);
		expect(await data.text()).not.toMatch(canaries);
	} finally {
		await context.close();
	}
});

test('SEO endpoints expose only public canonical URLs, even for signed-in users', async ({
	browser,
	baseURL,
	request
}) => {
	const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
	try {
		for (const url of ['/sitemap.xml', '/index.xml', '/robots.txt']) {
			const anonymous = await context.request.get(url);
			expect(anonymous.status()).toBe(200);
			expect(await (await request.get(url)).text()).toBe(await anonymous.text());
			expect(await anonymous.text()).not.toMatch(canaries);
			expect(await anonymous.text()).not.toContain(privateNote);
		}
		const sitemap = await (await context.request.get('/sitemap.xml')).text();
		expect(sitemap).toContain(`https://wisconsin.twango.dev${note}`);
		const head = await context.request.head(note);
		expect(head.status()).toBe(200);
		expect(await head.text()).toBe('');
		const owner = await request.get(note);
		expect(owner.headers()['cache-control']).toBe('private, no-store');
	} finally {
		await context.close();
	}
});
