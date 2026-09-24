import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, expect as browserExpect, type Browser } from '@playwright/test';

let browser: Browser;
let script: string;

beforeAll(async () => {
	const bundle = await Bun.build({
		entrypoints: ['./src/lib/analytics.ts'],
		target: 'browser',
		external: ['rrweb']
	});
	expect(bundle.success).toBe(true);
	script = await bundle.outputs[0].text();
	browser = await chromium.launch();
});

afterAll(async () => {
	await browser?.close();
});

// Use the real SDK to catch changes to its initial-pageview and identity timing.
test.each([
	{ name: 'signed in', status: 200, username: 'octocat', expected: 'octocat' },
	{ name: 'signed out', status: 401 },
	{ name: 'session unavailable', status: 503 },
	{ name: 'network failure', status: 0 },
	{ name: 'existing user without a username', status: 200 },
	{ name: 'storage opt-out', status: 200, username: 'octocat', optOut: 'storage' },
	{ name: 'window opt-out', status: 200, username: 'octocat', optOut: 'window' }
])('analytics: $name', async ({ status, username, expected, optOut }) => {
	const page = await browser.newPage();
	const events: Record<string, unknown>[] = [];
	const identities: Record<string, unknown>[] = [];
	let analyticsRequests = 0;
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	try {
		await page.addInitScript((optOut) => {
			localStorage.setItem('rybbit-user-id', 'previous-user');
			if (optOut === 'storage') localStorage.setItem('disable-rybbit', 'true');
			if (optOut === 'window') Object.assign(window, { __RYBBIT_OPTOUT__: true });
		}, optOut);
		await page.route('**/*', async (route) => {
			const url = new URL(route.request().url());
			if (url.pathname === '/api/access') {
				if (status === 0) await route.abort();
				else await route.fulfill({ status, json: { githubUsername: username } });
			} else if (url.pathname === '/analytics.js') {
				await route.fulfill({ contentType: 'text/javascript', body: script });
			} else if (url.hostname === 'rybbit.twango.dev') {
				analyticsRequests++;
				if (url.pathname === '/api/track') events.push(route.request().postDataJSON());
				if (url.pathname === '/api/identify') identities.push(route.request().postDataJSON());
				await route.fulfill({ json: {}, headers: { 'Access-Control-Allow-Origin': '*' } });
			} else {
				await route.fulfill({
					contentType: 'text/html',
					body: `<script type="module">
						import { initializeAnalytics } from '/analytics.js';
						await initializeAnalytics();
						document.documentElement.dataset.analyticsReady = 'true';
					</script>`
				});
			}
		});
		await page.goto('http://analytics.test/');
		await browserExpect(page.locator('html')).toHaveAttribute('data-analytics-ready', 'true');
		if (optOut) {
			expect(analyticsRequests).toBe(0);
		} else {
			await browserExpect.poll(() => events.length).toBe(1);
			expect(events[0].type).toBe('pageview');
			expect(events[0].user_id).toBe(expected);
			expect(await page.evaluate(() => localStorage.getItem('rybbit-user-id'))).toBe(
				expected ?? null
			);
			if (expected) {
				await browserExpect.poll(() => identities.length).toBe(1);
				expect(identities[0].user_id).toBe(expected);
			} else expect(identities).toHaveLength(0);
			await page.evaluate(() => history.pushState({}, '', '/next'));
			await browserExpect.poll(() => events.length).toBe(2);
			expect(events[1].user_id).toBe(expected);
		}
		expect(errors).toEqual([]);
	} finally {
		await page.close();
	}
});
