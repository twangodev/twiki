import { expect, test } from 'bun:test';
import { authenticateRequest } from '../../worker/gate';
import { loginPage } from '../../worker/login';
import { proxyAnalytics } from '../../worker/analytics';
import type { AuthEnv } from '../../worker/auth';
const origin = 'https://vault.example.test';
const env = {
	ORIGIN: origin,
	AUTH_MODE: 'none',
	get DB() {
		throw Error('Public-only hosting must not query D1');
	}
} as AuthEnv;
test('public-only hosting ignores session cookies and never serves a private fallback', async () => {
	let privateReads = 0;
	const serve = async () => {
		privateReads++;
		return new Response('private');
	};
	for (const cookie of ['', 'better-auth.session_token=forged']) {
		const publicResponse = await authenticateRequest(
			new Request(origin + '/note', { headers: { cookie } }),
			env,
			serve,
			async () => new Response('public')
		);
		expect(publicResponse.status).toBe(200);
		expect(await publicResponse.text()).toBe('public');
		const denied = await authenticateRequest(
			new Request(origin + '/private', { headers: { cookie } }),
			env,
			serve,
			async () => null
		);
		expect(denied.status).toBe(404);
	}
	expect(privateReads).toBe(0);
});
test('public-only hosting denies internal assets, login, APIs, writes and foreign origins', async () => {
	let publicationReads = 0;
	const published = async () => {
		publicationReads++;
		return null;
	};
	for (const pathname of [
		'/login',
		'/api/access',
		'/_content/current.json',
		'/%5fcontent/full/manifest.json'
	]) {
		const result = await authenticateRequest(
			new Request(origin + pathname),
			env,
			async () => {
				throw Error('private fallback');
			},
			published
		);
		expect(result.status).toBe(404);
	}
	const write = await authenticateRequest(
		new Request(origin + '/note', { method: 'POST' }),
		env,
		async () => {
			throw Error('write fallback');
		},
		async () => new Response('public')
	);
	expect(write.status).toBe(404);
	const foreign = await authenticateRequest(
		new Request('https://foreign.example/note'),
		env,
		async () => {
			throw Error('foreign fallback');
		},
		published
	);
	expect(foreign.status).toBe(421);
	expect(publicationReads).toBe(2);
});
test('custom login branding is escaped and analytics is disabled without configuration', async () => {
	const html = await loginPage('/', false, '<vault>', 'Notes & ideas').text();
	expect(html).toContain('&lt;vault&gt;');
	expect(html).toContain('Notes &amp; ideas');
	expect(html).not.toContain('<h1><vault>');
	const disabled = await proxyAnalytics(new Request(origin + '/api/analytics/track'), (() => {
		throw Error('analytics must be opt-in');
	}) as typeof fetch);
	expect(disabled.status).toBe(404);
	const result = await proxyAnalytics(
		new Request(origin + '/api/analytics/site/tracking-config/99'),
		(async (url) => {
			expect(url).toBe('https://stats.example.test/api/site/tracking-config/99');
			return Response.json({ ok: true });
		}) as typeof fetch,
		{ siteId: '99', endpoint: 'https://stats.example.test/api' }
	);
	expect(result.status).toBe(200);
});
