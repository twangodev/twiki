import { test, expect } from '@playwright/test';
import { siGithub } from 'simple-icons';
import { readFileSync } from 'node:fs';
import type { CourseFile } from '../../src/lib/files';

const publicAssets = JSON.parse(readFileSync('.generated/public-assets.json', 'utf8'));
const privatePage = '/sp26-cs544/lectures/lecture-01';

for (const mode of ['light', 'dark'] as const) {
	test(`login matches the ${mode} site theme and uses the Simple Icons mark`, async ({
		browser,
		baseURL
	}) => {
		const owner = await browser.newContext({ baseURL, storageState: '.generated/auth-state.json' });
		const anonymous = await browser.newContext({
			baseURL,
			colorScheme: mode === 'light' ? 'dark' : 'light',
			storageState: { cookies: [], origins: [] }
		});
		try {
			for (const context of [owner, anonymous])
				await context.addInitScript(
					(value) => localStorage.setItem('mode-watcher-mode', value),
					mode
				);
			const article = await owner.newPage();
			await article.goto('/');
			if (mode === 'dark') await expect(article.locator('html')).toHaveClass(/dark/);
			else await expect(article.locator('html')).not.toHaveClass(/dark/);
			const colors = await article.locator('body').evaluate((node) => ({
				background: getComputedStyle(node).backgroundColor,
				text: getComputedStyle(node).color,
				font: getComputedStyle(node).fontFamily
			}));
			const login = await anonymous.newPage();
			await login.goto('/login');
			await expect(login).toHaveTitle('Sign in · wisconsin');
			await expect(login.getByRole('heading', { name: 'wisconsin', exact: true })).toBeVisible();
			await expect(login.locator('html')).toHaveCSS('background-color', colors.background);
			await expect(login.locator('html')).toHaveCSS('color', colors.text);
			await expect(login.locator('html')).toHaveCSS('font-family', colors.font);
			await login.evaluate(() => document.fonts.ready);
			expect(await login.evaluate(() => document.fonts.check('16px "Overused Grotesk"'))).toBe(
				true
			);
			await expect(
				login.getByRole('button', { name: 'Continue with GitHub' }).locator('svg path')
			).toHaveAttribute('d', siGithub.path);
			expect((await anonymous.request.get('/fonts/OverusedGrotesk-VF.woff2')).status()).toBe(200);
			expect((await anonymous.request.get('/fonts/JetBrainsMono-VF.woff2')).status()).toBe(
				publicAssets['/fonts/JetBrainsMono-VF.woff2'] ? 200 : 401
			);
			await login.setViewportSize({ width: 390, height: 844 });
			await login.screenshot({ path: `.generated/login-${mode}.png` });
		} finally {
			await owner.close();
			await anonymous.close();
		}
	});
}

test('anonymous visitors cannot fetch private content, even after the owner warms it', async ({
	browser,
	request,
	baseURL
}) => {
	const homepage = await request.get('/');
	expect(homepage.status()).toBe(200);
	const html = await homepage.text();
	const asset = html.match(/(?:src|href)="([^"\s]*\/_app\/immutable\/[^"\s]+)"/)?.[1];
	expect(asset).toBeTruthy();
	const files: CourseFile[] = await (await request.get('/_files/index/sp26-cs544.json')).json();
	const privateFile = files.find((file) => file.note === privatePage)!;
	expect(privateFile.download).toBeTruthy();
	expect(publicAssets[privateFile.download!]).toBeUndefined();
	const anonymous = await browser.newContext({
		baseURL,
		storageState: { cookies: [], origins: [] }
	});
	try {
		for (const path of [
			privateFile.download!,
			privatePage,
			`${privatePage}/__data.json`,
			'/_files/index/sp26-cs544.json',
			'/',
			'/graph.json',
			'/pagefind/pagefind.js',
			'/index.xml',
			'/sitemap.xml',
			asset!
		].filter((path) => !publicAssets[path])) {
			expect((await request.get(path)).status()).toBe(200);
			for (const method of ['GET', 'HEAD']) {
				const response = await anonymous.request.fetch(path, { method });
				expect(response.status()).toBe(401);
				expect(response.headers()['cache-control']).toBe('private, no-store');
			}
		}
		const page = await anonymous.newPage();
		await page.goto(privatePage);
		await expect(page.getByText('Content locked', { exact: true })).toBeVisible();
		await page.getByRole('link', { name: 'Sign in to read' }).click();
		await expect(page).toHaveURL(/\/login\?next=/);
		await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
		expect(await page.locator('script[src]').count()).toBe(0);
		await page.screenshot({ path: '.generated/login.png' });
		const login = await anonymous.request.post('/login', {
			headers: { Origin: baseURL! },
			form: { next: '/graph.json' },
			maxRedirects: 0
		});
		expect(login.status()).toBe(303);
		const github = new URL(login.headers().location);
		expect(github.origin + github.pathname).toBe('https://github.com/login/oauth/authorize');
		expect(github.searchParams.get('state')).toBeTruthy();
		expect(github.searchParams.get('code_challenge')).toBeTruthy();
	} finally {
		await anonymous.close();
	}
});

test('sign-out removes access and invalidates the old session', async ({ browser, baseURL }) => {
	const context = await browser.newContext({
		baseURL,
		storageState: '.generated/logout-state.json'
	});
	try {
		const oldCookies = (await context.cookies())
			.map((cookie) => `${cookie.name}=${cookie.value}`)
			.join('; ');
		const page = await context.newPage();
		await page.goto(privatePage);
		await page.getByRole('button', { name: 'Sign out', exact: true }).click();
		await expect(page).toHaveURL(/\/login$/);
		expect(
			(await context.request.get('/api/access', { headers: { cookie: oldCookies } })).status()
		).toBe(401);
		await page.goBack();
		await expect(page.getByText('Content locked', { exact: true })).toBeVisible();
	} finally {
		await context.close();
	}
});

test('production Worker rejects cross-origin login and unsafe redirects', async ({
	browser,
	baseURL
}) => {
	const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
	try {
		const response = await context.request.post('/login', {
			headers: { Origin: 'https://evil.invalid' },
			form: { next: '/' }
		});
		expect(response.status()).toBe(403);
		const page = await context.newPage();
		await page.goto('/login?next=//evil.invalid');
		await expect(page.locator('input[name="next"]')).toHaveValue('/');
		const signup = await context.request.post('/api/auth/sign-up/email', { data: {} });
		expect(signup.status()).toBe(404);
	} finally {
		await context.close();
	}
});
