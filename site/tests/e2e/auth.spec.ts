import { test, expect } from '@playwright/test';

test('anonymous visitors cannot fetch built content, even after the owner warms it', async ({
	browser,
	request,
	baseURL
}) => {
	const homepage = await request.get('/');
	expect(homepage.status()).toBe(200);
	const html = await homepage.text();
	const asset = html.match(/(?:src|href)="([^"\s]*\/_app\/immutable\/[^"\s]+)"/)?.[1];
	expect(asset).toBeTruthy();
	const anonymous = await browser.newContext({
		baseURL,
		storageState: { cookies: [], origins: [] }
	});
	try {
		for (const path of [
			'/',
			'/graph.json',
			'/pagefind/pagefind.js',
			'/index.xml',
			'/sitemap.xml',
			asset!
		]) {
			expect((await request.get(path)).status()).toBe(200);
			for (const method of ['GET', 'HEAD']) {
				const response = await anonymous.request.fetch(path, { method });
				expect(response.status()).toBe(401);
				expect(response.headers()['cache-control']).toBe('private, no-store');
			}
		}
		const page = await anonymous.newPage();
		await page.goto('/');
		await expect(page).toHaveURL(/\/login\?next=/);
		await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
		expect(await page.locator('script').count()).toBe(0);
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
		await page.goto('/');
		await page.getByRole('button', { name: 'Sign out', exact: true }).click();
		await expect(page).toHaveURL(/\/login$/);
		expect(
			(await context.request.get('/graph.json', { headers: { cookie: oldCookies } })).status()
		).toBe(401);
		await page.goBack();
		await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
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
