import { expect, test } from '@playwright/test';

test('only the owner can manage access, and revocation blocks existing sessions', async ({
	page,
	browser,
	baseURL
}) => {
	const member = await browser.newContext({ storageState: 'build/generated/member-state.json' });
	const origin = baseURL!;
	try {
		expect((await member.request.get(`${origin}/graph.json`)).status()).toBe(200);
		expect((await member.request.get(`${origin}/admin/access`)).status()).toBe(403);
		const memberPage = await member.newPage();
		await memberPage.goto(origin);
		await expect(memberPage.getByRole('link', { name: 'Manage access' })).toHaveCount(0);
		const deniedData = await member.request.get(`${origin}/admin/access/__data.json`);
		expect(await deniedData.text()).not.toContain('fixture-member');
		for (const action of ['add', 'revoke']) {
			expect(
				(
					await member.request.post(`${origin}/admin/access?/${action}`, {
						form: { username: 'example', githubId: '123456' },
						headers: { Origin: origin }
					})
				).status()
			).toBe(403);
		}
		await page.goto('/admin/access');
		await expect(page.getByRole('heading', { name: 'Access', exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Manage access' })).toBeVisible();
		await expect(page.getByText('@fixture-member', { exact: true })).toBeVisible();
		expect(
			(
				await page.request.post('/admin/access?/revoke', {
					form: { githubId: '123456' },
					headers: { Origin: 'https://attacker.example' }
				})
			).status()
		).toBe(403);
		expect(
			(
				await page.request.post('/admin/access?/revoke', {
					form: { githubId: '48845764' },
					headers: { Origin: origin, Accept: 'text/html' }
				})
			).status()
		).toBe(400);
		await page.getByLabel('GitHub username').fill('../invalid');
		await page.getByRole('button', { name: 'Add access' }).click();
		await expect(page.getByRole('alert')).toHaveText('Enter a valid GitHub username.');
		await page.setViewportSize({ width: 390, height: 844 });
		await expect(page.getByRole('button', { name: 'Add access' })).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			390
		);
		page.once('dialog', (dialog) => dialog.accept());
		await page.getByRole('button', { name: 'Revoke @fixture-member', exact: true }).click();
		await expect(page.getByRole('status')).toHaveText(
			'Access revoked. Existing sessions have been signed out.'
		);
		await expect(page.getByText('@fixture-member', { exact: true })).toHaveCount(0);
		expect(
			await (await member.request.get(`${origin}/sp26-cs544/lectures/lecture-01`)).text()
		).toContain('Content locked');
		expect((await member.request.get(`${origin}/api/access`)).status()).toBe(401);
		expect((await page.request.get('/graph.json')).status()).toBe(200);
	} finally {
		await member.close();
	}
});

test('owner resolves GitHub profiles in the browser before granting access', async ({
	page,
	baseURL
}) => {
	let lookups = 0;
	let grants = 0;
	page.on('request', (request) => {
		if (request.method() === 'POST' && request.url().includes('/admin/access?/add')) grants++;
	});
	await page.route('https://api.github.com/users/browser-test', async (route) => {
		lookups++;
		await route.fulfill(
			lookups === 1
				? {
						status: 403,
						headers: {
							'x-ratelimit-remaining': '0',
							'access-control-expose-headers': 'x-ratelimit-remaining'
						},
						json: { message: 'API rate limit exceeded' }
					}
				: {
						json: { id: 234567, login: 'browser-test', type: 'User' }
					}
		);
	});
	await page.goto('/admin/access');
	await page.getByLabel('GitHub username').fill('browser-test');
	await page.getByRole('button', { name: 'Add access' }).click();
	await expect(page.getByRole('alert')).toContainText('rate-limited');
	expect(lookups).toBe(1);
	expect(grants).toBe(0);
	await page.getByRole('button', { name: 'Add access' }).click();
	await expect(page.getByRole('status')).toHaveText(
		'@browser-test can now sign in and read all courses.'
	);
	await expect(page.getByRole('link', { name: '@browser-test', exact: true })).toBeVisible();
	expect(lookups).toBe(2);
	expect(grants).toBe(1);
	for (const form of [
		{ username: 'browser-test' },
		{ githubId: '-1', githubLogin: 'browser-test' },
		{ githubId: '234567', githubLogin: '../invalid' },
		{ githubId: '48845764', githubLogin: 'owner' }
	] as Record<string, string>[]) {
		expect(
			(
				await page.request.post('/admin/access?/add', {
					form,
					headers: { Origin: baseURL!, Accept: 'text/html' }
				})
			).status()
		).toBe(400);
	}
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Revoke @browser-test', exact: true }).click();
	await expect(page.getByRole('link', { name: '@browser-test', exact: true })).toHaveCount(0);
});
