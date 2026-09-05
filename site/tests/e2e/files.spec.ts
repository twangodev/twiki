import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileIndexUrl, fileRoute, type CourseFile } from '../../src/lib/files';

const course = 'fa24-cs300';
const files: CourseFile[] = JSON.parse(readFileSync(`static/_files/index/${course}.json`, 'utf8'));
const java = files.find((file) => file.path.endsWith('/ElectionManager.java'))!;

test('files stay secondary and open a highlighted source viewer', async ({ page }) => {
	const indexes: string[] = [];
	page.on('request', (request) => {
		if (request.url().includes('/_files/index/')) indexes.push(request.url());
	});
	await page.goto(`/${course}/README`);
	const drawer = page.getByRole('region', { name: 'Course files' });
	const toggle = page
		.getByRole('group', { name: 'Explorer view' })
		.getByRole('button', { name: 'Files', exact: true });
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	await expect(drawer).toHaveCount(0);
	expect(indexes).toHaveLength(0);
	await toggle.click();
	await expect(drawer.getByRole('link', { name: /Browse directory/ })).toBeVisible();
	await page.getByRole('button', { name: 'Notes', exact: true }).click();
	await expect(drawer).toHaveCount(0);
	await toggle.click();
	await drawer.getByRole('link', { name: /Browse directory/ }).click();
	await expect(page).toHaveURL(fileRoute(course));
	await page
		.getByRole('list', { name: 'Directory contents' })
		.getByRole('link', { name: /^p01 / })
		.click();
	await page.goto(fileRoute(course, java.path));
	await expect(
		page.getByRole('heading', { name: 'ElectionManager.java', exact: true })
	).toBeVisible();
	await expect(page.locator('.file-code .cm-line').first()).toBeVisible();
	await expect(page.locator('.file-code .cm-line span[class]').first()).toBeVisible();
	await expect(drawer.locator('[aria-current="page"]')).toHaveText('ElectionManager.java');
	await expect(drawer.locator('[aria-current="page"] img').first()).toHaveAttribute(
		'src',
		'/_files/icons/java.svg'
	);
	await expect(page.locator('main header [data-file-icon] img').first()).toHaveAttribute(
		'src',
		'/_files/icons/java.svg'
	);
	await expect(drawer.locator('[aria-current="page"]')).toBeInViewport();
	await expect(page.getByRole('link', { name: 'Download', exact: true })).toHaveAttribute(
		'download',
		'ElectionManager.java'
	);
	const downloadEvent = page.waitForEvent('download');
	await page.getByRole('link', { name: 'Download', exact: true }).click();
	expect((await downloadEvent).suggestedFilename()).toBe('ElectionManager.java');
	await page.setViewportSize({ width: 1920, height: 1080 });
	const availableWidth = await page.locator('main').evaluate((main) => {
		const style = getComputedStyle(main);
		return main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
	});
	expect((await page.locator('.file-content').boundingBox())!.width).toBeCloseTo(availableWidth, 0);
	expect(await page.locator('main').evaluate((main) => getComputedStyle(main).padding)).toBe('0px');
	expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
		true
	);
	await page.screenshot({ path: '.generated/file-viewer-desktop.png', animations: 'disabled' });
	await page.setViewportSize({ width: 390, height: 844 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
	await page.screenshot({ path: '.generated/file-viewer-mobile.png', animations: 'disabled' });
});

test('Markdown links back to notes, PDFs embed, images preview, and missing paths return 404', async ({
	page,
	request
}) => {
	await page.goto(fileRoute(course, 'README.md'));
	await expect(page.getByRole('link', { name: 'Read note', exact: true })).toHaveAttribute(
		'href',
		`/${course}/README`
	);
	const pdfCourse = 'fa25-cs354';
	const pdfFiles: CourseFile[] = JSON.parse(
		readFileSync(`static/_files/index/${pdfCourse}.json`, 'utf8')
	);
	const pdf = pdfFiles.find((file) => file.kind === 'pdf')!;
	await page.goto(fileRoute(pdfCourse, pdf.path));
	await expect(page.locator('main iframe')).toHaveAttribute('src', pdf.download!);
	expect((await request.get(pdf.download!)).headers()['content-type']).toContain('application/pdf');
	expect((await request.get(pdf.download!)).headers()['x-frame-options']).toBe('SAMEORIGIN');
	const image = files.find((file) => file.kind === 'image')!;
	await page.goto(fileRoute(course, image.path));
	await expect(page.locator('.file-content img')).toBeVisible();
	expect(
		await page
			.locator('.file-content img')
			.evaluate((image) => (image as HTMLImageElement).naturalWidth)
	).toBeGreaterThan(0);
	expect((await request.get(fileRoute(course, 'does-not-exist.java'))).status()).toBe(404);
});

test('file catalogs stay public while file bodies remain authenticated after warming', async ({
	request,
	browser,
	baseURL
}) => {
	const anonymous = await browser.newContext({
		baseURL,
		storageState: { cookies: [], origins: [] }
	});
	try {
		for (const path of [fileRoute(course, java.path), fileIndexUrl(course), java.download!]) {
			expect((await request.get(path)).status()).toBe(200);
			for (const method of ['GET', 'HEAD']) {
				const response = await anonymous.request.fetch(path, { method });
				expect(response.status()).toBe(path === java.download ? 401 : 200);
				if (path === java.download)
					expect(response.headers()['cache-control']).toBe('private, no-store');
			}
		}
		const catalog: CourseFile[] = await (await anonymous.request.get(fileIndexUrl(course))).json();
		expect(catalog.filter((file) => !file.locked).map((file) => file.path)).toEqual(['README.md']);
		expect(
			catalog.filter((file) => file.locked).every((file) => !file.download && !file.history)
		).toBe(true);
		const page = await anonymous.newPage();
		await page.goto(fileRoute(course, java.path));
		await expect(page.getByText('Content locked', { exact: true })).toBeVisible();
		await expect(page.locator('.cm-content')).toHaveCount(0);
		expect((await request.get(java.download!)).headers()['content-type']).toContain(
			'application/octet-stream'
		);
	} finally {
		await anonymous.close();
	}
});
