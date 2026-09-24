import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, expect as browserExpect, type Browser } from '@playwright/test';
import { proxyAnalytics } from '../worker/analytics';

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
	page.on('console', (message) => {
		if (message.text().includes('CORS')) errors.push(message.text());
	});
	const upstreamHeaders: Headers[] = [];
	// Real HTTP servers preserve Chromium's CORS enforcement; route.fulfill bypasses it.
	const upstream = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		async fetch(request) {
			analyticsRequests++;
			upstreamHeaders.push(request.headers);
			const path = new URL(request.url).pathname;
			if (path === '/api/track') events.push(await request.json());
			if (path === '/api/identify') identities.push(await request.json());
			// Deliberately omit CORS headers, as no browser should contact this server directly.
			return Response.json({});
		}
	});
	const relayFetch = ((input, init) =>
		fetch(new URL(new URL(String(input)).pathname, upstream.url), init)) as typeof fetch;
	const site = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		fetch(request) {
			const path = new URL(request.url).pathname;
			if (path === '/api/access')
				return Response.json({ githubUsername: username }, { status: status || 503 });
			if (path === '/analytics.js')
				return new Response(script, { headers: { 'Content-Type': 'text/javascript' } });
			if (path.startsWith('/api/analytics/')) return proxyAnalytics(request, relayFetch);
			return new Response(
				`<script type="module">
				import { initializeAnalytics } from '/analytics.js';
				await initializeAnalytics();
				document.documentElement.dataset.analyticsReady = 'true';
			</script>`,
				{ headers: { 'Content-Type': 'text/html' } }
			);
		}
	});
	try {
		await page.addInitScript((optOut) => {
			localStorage.setItem('rybbit-user-id', 'previous-user');
			if (optOut === 'storage') localStorage.setItem('disable-rybbit', 'true');
			if (optOut === 'window') Object.assign(window, { __RYBBIT_OPTOUT__: true });
		}, optOut);
		await page.context().addCookies([{ name: 'session', value: 'private', url: site.url.origin }]);
		await page.setExtraHTTPHeaders({ Authorization: 'Bearer private' });
		if (status === 0) await page.route('**/api/access', (route) => route.abort());
		await page.goto(site.url.href);
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
		for (const headers of upstreamHeaders) {
			expect(headers.has('cookie')).toBe(false);
			expect(headers.has('authorization')).toBe(false);
		}
		expect(errors).toEqual([]);
	} finally {
		await page.close();
		site.stop(true);
		upstream.stop(true);
	}
});
