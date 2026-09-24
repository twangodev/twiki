import { expect, test } from 'bun:test';
import { proxyAnalytics } from '../../worker/analytics';
import { authenticateRequest } from '../../worker/gate';
import type { AuthEnv } from '../../worker/auth';

const origin = 'https://wisconsin.twango.dev';
const request = (path: string, init?: RequestInit) =>
	new Request(origin + '/api/analytics' + path, init);

test('analytics relay strips credentials, preserves visitor metadata and never caches responses', async () => {
	const response = await proxyAnalytics(
		request('/track?ignored=true', {
			method: 'POST',
			headers: {
				Cookie: 'private=session',
				Authorization: 'Bearer secret',
				Origin: origin,
				'User-Agent': 'test-browser',
				Accept: '*/*',
				'Sec-Fetch-Mode': 'no-cors',
				'Sec-CH-UA': 'Chromium',
				'CF-Connecting-IP': '192.0.2.1',
				'X-Forwarded-For': 'spoofed'
			},
			body: JSON.stringify({ site_id: 4, user_id: 'octocat', type: 'pageview' })
		}),
		(async (url, init) => {
			expect(url).toBe('https://rybbit.twango.dev/api/track');
			const headers = new Headers(init?.headers);
			expect(headers.has('cookie')).toBe(false);
			expect(headers.has('authorization')).toBe(false);
			expect(headers.get('user-agent')).toBe('test-browser');
			expect(headers.get('accept')).toBe('*/*');
			expect(headers.get('sec-fetch-mode')).toBe('no-cors');
			expect(headers.get('sec-ch-ua')).toBe('Chromium');
			expect(headers.get('x-forwarded-for')).toBe('192.0.2.1');
			expect(headers.get('origin')).toBe(origin);
			expect(JSON.parse(init?.body as string).user_id).toBe('octocat');
			expect(init?.redirect).toBe('manual');
			return new Response(null, { status: 204, headers: { 'Set-Cookie': 'upstream=secret' } });
		}) as typeof fetch
	);
	expect(response.status).toBe(204);
	expect(response.headers.has('set-cookie')).toBe(false);
	expect(response.headers.get('cache-control')).toBe('no-store');
});

test('analytics relay rejects unrelated endpoints, methods, origins and site IDs', async () => {
	const neverFetch = (() => {
		throw new Error('Unexpected upstream request');
	}) as unknown as typeof fetch;
	for (const [req, status] of [
		[request('/admin'), 404],
		[request('/site/tracking-config/5'), 404],
		[request('/track'), 405],
		[request('/track', { method: 'POST', headers: { Origin: 'https://elsewhere.test' } }), 403],
		[request('/track', { method: 'POST', body: '{' }), 400],
		[request('/identify', { method: 'POST', body: JSON.stringify({ site_id: '5' }) }), 400]
	] as const)
		expect((await proxyAnalytics(req, neverFetch)).status).toBe(status);
});

test('analytics upstream failures return an uncached 502', async () => {
	const response = await proxyAnalytics(request('/site/tracking-config/4'), (async () => {
		throw new Error('upstream unavailable');
	}) as unknown as typeof fetch);
	expect(response.status).toBe(502);
	expect(response.headers.get('cache-control')).toBe('no-store');
});

test('anonymous analytics configuration bypasses auth without exposing other routes', async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () =>
		Response.json({ trackInitialPageView: true })) as unknown as typeof fetch;
	try {
		const response = await authenticateRequest(
			request('/site/tracking-config/4'),
			{ ORIGIN: origin } as AuthEnv,
			async () => {
				throw new Error('Analytics must not reach private assets');
			}
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ trackInitialPageView: true });
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('analytics relay runs in workerd and rejects upstream redirects', async () => {
	const { Miniflare } = await import('miniflare');
	const bundle = await Bun.build({ entrypoints: ['./worker/analytics.ts'], target: 'browser' });
	expect(bundle.success).toBe(true);
	const script =
		(await bundle.outputs[0].text()) +
		'\nexport default { fetch(request) { return proxyAnalytics(request); } };';
	let redirect = false;
	const runtime = new Miniflare({
		modules: true,
		script,
		compatibilityDate: '2026-06-07',
		compatibilityFlags: ['nodejs_compat'],
		outboundService: () =>
			redirect
				? new Response(null, { status: 302, headers: { Location: 'https://elsewhere.test' } })
				: Response.json({ trackInitialPageView: true })
	});
	try {
		const url = origin + '/api/analytics/site/tracking-config/4';
		const response = await runtime.dispatchFetch(url);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ trackInitialPageView: true });
		redirect = true;
		const redirected = await runtime.dispatchFetch(url);
		expect(redirected.status).toBe(502);
		expect(redirected.headers.get('cache-control')).toBe('no-store');
	} finally {
		await runtime.dispose();
	}
});
