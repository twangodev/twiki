import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { betterAuth } from 'better-auth';
import { testUtils } from 'better-auth/plugins';
import { getMigrations } from 'better-auth/db/migration';
import { createAuth, isOwner, type AuthEnv } from '../worker/auth';
import { authenticateRequest } from '../worker/gate';
import { loginPage, returnPath } from '../worker/login';

describe('private Worker gate', () => {
	let proxy: Awaited<ReturnType<typeof getPlatformProxy<AuthEnv>>>;
	let env: AuthEnv;
	let cookie: string;
	let token: string;
	let userId: string;
	let served = 0;
	const origin = 'http://127.0.0.1:4173';

	beforeAll(async () => {
		proxy = await getPlatformProxy<AuthEnv>({ persist: false, remoteBindings: false });
		env = {
			...proxy.env,
			ORIGIN: origin,
			GITHUB_CLIENT_ID: 'test',
			GITHUB_CLIENT_SECRET: 'test',
			BETTER_AUTH_SECRET: 'test-only-private-worker-secret-0000000000'
		};
		const statements = readFileSync('migrations/0001_auth.sql', 'utf8')
			.split(';')
			.map((s) => s.trim())
			.filter(Boolean);
		await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
		const auth = betterAuth({ ...createAuth(env).options, plugins: [testUtils()] });
		const ctx = await auth.$context;
		const user = await ctx.test.saveUser(ctx.test.createUser());
		userId = user.id;
		await ctx.internalAdapter.createAccount({
			userId,
			providerId: 'github',
			accountId: env.OWNER_GITHUB_ID,
			issuer: 'local:oauth:github'
		});
		const login = await ctx.test.login({ userId });
		cookie = login.headers.get('cookie')!;
		token = login.token;
	}, 30_000);
	afterAll(async () => {
		await proxy?.dispose();
	});

	function request(path: string, init?: RequestInit, config = env) {
		return authenticateRequest(new Request(origin + path, init), config, async () => {
			served++;
			return new Response('private course content', {
				headers: { 'Cache-Control': 'public, max-age=31536000' }
			});
		});
	}

	test('checked-in schema matches Better Auth on D1', async () => {
		const migration = await getMigrations(createAuth(env).options);
		expect(migration.toBeCreated).toHaveLength(0);
		expect(migration.toBeAdded).toHaveLength(0);
		expect(migration.toBeAddedIndexes).toHaveLength(0);
	});
	test('anonymous requests never reach assets', async () => {
		for (const path of [
			'/',
			'/sp26-cs544/README',
			'/graph.json',
			'/pagefind/pagefind.js',
			'/_app/immutable/nav.js',
			'/index.xml',
			'/sitemap.xml',
			'/image.png',
			'/note/__data.json',
			'/missing',
			'/%6cogin/../graph.json'
		]) {
			for (const method of ['GET', 'HEAD']) {
				const response = await request(path, { method });
				expect(response.status).toBe(401);
				expect(response.headers.get('cache-control')).toBe('private, no-store');
			}
		}
		expect(served).toBe(0);
	});
	test('document navigation redirects with a safe return path', async () => {
		const response = await request('/course/notes?q=1', { headers: { accept: 'text/html' } });
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/login?next=%2Fcourse%2Fnotes%3Fq%3D1');
	});
	test('login is public and contains no course bundles', async () => {
		const response = await request('/login');
		const html = await response.text();
		expect(response.status).toBe(200);
		expect(html).toContain('Continue with GitHub');
		expect(html).not.toMatch(/_app|pagefind|graph.json|<script/);
	});
	test('owner sessions permit assets without public caching', async () => {
		const response = await request('/graph.json', { headers: { cookie } });
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('private course content');
		expect(response.headers.get('cache-control')).toBe('private, no-store');
	});
	test('owner authorization is checked again on every request', async () => {
		expect(await isOwner(env.DB, userId, '1')).toBe(false);
		const response = await request(
			'/graph.json',
			{ headers: { cookie } },
			{ ...env, OWNER_GITHUB_ID: '1' }
		);
		expect(response.status).toBe(401);
	});
	test('configuration errors fail closed', async () => {
		expect((await request('/graph.json', {}, { ...env, BETTER_AUTH_SECRET: '' })).status).toBe(503);
		expect((await request('/graph.json', {}, { ...env, DB: undefined! })).status).toBe(503);
		expect((await request('/login', {}, { ...env, ORIGIN: 'https://wrong.invalid' })).status).toBe(
			421
		);
	});
	test('login and logout reject cross-origin forms', async () => {
		for (const path of ['/login', '/logout']) {
			expect(
				(
					await request(path, {
						method: 'POST',
						headers: { origin: 'https://evil.invalid', cookie }
					})
				).status
			).toBe(403);
		}
	});
	test('unused auth endpoints are not exposed', async () => {
		expect((await request('/api/auth/sign-up/email', { method: 'POST' })).status).toBe(404);
		expect((await request('/api/auth/link-social', { method: 'POST' })).status).toBe(404);
	});
	test('GitHub OAuth creates an owner session and rejects other accounts', async () => {
		const originalFetch = globalThis.fetch;
		let githubId = 22;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input instanceof Request ? input.url : input);
			if (url === 'https://github.com/login/oauth/access_token')
				return Response.json({
					access_token: 'test-github-token',
					token_type: 'bearer',
					scope: 'read:user,user:email'
				});
			if (url === 'https://api.github.com/user')
				return Response.json({
					id: githubId,
					login: 'test-owner',
					name: 'Test Owner',
					email: `owner${githubId}@example.com`
				});
			if (url === 'https://api.github.com/user/emails')
				return Response.json([
					{ email: `owner${githubId}@example.com`, primary: true, verified: true }
				]);
			return originalFetch(input, init);
		}) as typeof fetch;
		try {
			const oauthEnv = { ...env, OWNER_GITHUB_ID: '22' };
			for (const id of [22, 23]) {
				githubId = id;
				const start = await request(
					'/login',
					{
						method: 'POST',
						headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
						body: 'next=%2Fgraph.json'
					},
					oauthEnv
				);
				expect(start.status).toBe(303);
				const location = new URL(start.headers.get('location')!);
				expect(location.origin).toBe('https://github.com');
				const state = location.searchParams.get('state');
				expect(state).toBeTruthy();
				const stateCookie = start.headers
					.getSetCookie()
					.map((c) => c.split(';')[0])
					.join('; ');
				const callback = await request(
					`/api/auth/callback/github?code=test-code&state=${encodeURIComponent(state!)}`,
					{ headers: { cookie: stateCookie } },
					oauthEnv
				);
				const sessionCookie = callback.headers
					.getSetCookie()
					.map((c) => c.split(';')[0])
					.join('; ');
				const protectedResponse = await request(
					'/graph.json',
					{ headers: { cookie: sessionCookie } },
					oauthEnv
				);
				expect(protectedResponse.status).toBe(id === 22 ? 200 : 401);
				if (id === 22) {
					const logout = await request(
						'/logout',
						{ method: 'POST', headers: { origin, cookie: sessionCookie } },
						oauthEnv
					);
					expect(logout.status).toBe(303);
					expect(
						(await request('/graph.json', { headers: { cookie: sessionCookie } }, oauthEnv)).status
					).toBe(401);
				}
			}
			expect(
				await env.DB.prepare('SELECT id FROM account WHERE accountId = ?').bind('23').first()
			).toBeNull();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
	test('session refresh cookies survive the Worker gate', async () => {
		await env.DB.prepare('UPDATE session SET updatedAt = ?, expiresAt = ? WHERE token = ?')
			.bind(Date.now() - 2 * 86400000, Date.now() + 5 * 86400000, token)
			.run();
		const response = await request('/graph.json', { headers: { cookie } });
		expect(response.status).toBe(200);
		expect(response.headers.getSetCookie().some((value) => value.includes('session_token='))).toBe(
			true
		);
	});
	test('database-backed rate limits persist across auth instances', async () => {
		let response: Response;
		for (let index = 0; index <= 100; index++) {
			response = await request('/api/auth/get-session', {
				headers: { 'cf-connecting-ip': '198.51.100.44' }
			});
		}
		expect(response!.status).toBe(429);
		expect(Number(response!.headers.get('x-retry-after'))).toBeGreaterThan(0);
	}, 10_000);
	test('production session cookies are secure and host-only', async () => {
		const ctx = await createAuth({ ...env, ORIGIN: 'https://wisconsin.twango.dev' }).$context;
		expect(ctx.authCookies.sessionToken.attributes.secure).toBe(true);
		expect(ctx.authCookies.sessionToken.attributes.httpOnly).toBe(true);
		expect(ctx.authCookies.sessionToken.attributes.domain).toBeUndefined();
	});
	test('tampered and expired sessions cannot read assets', async () => {
		expect(
			(await request('/graph.json', { headers: { cookie: cookie + 'tampered' } })).status
		).toBe(401);
		await env.DB.prepare('UPDATE session SET expiresAt = ? WHERE token = ?').bind(0, token).run();
		expect((await request('/graph.json', { headers: { cookie } })).status).toBe(401);
	});
});

test('return URLs cannot leave the origin or inject markup', async () => {
	for (const value of [
		'https://evil.invalid',
		'//evil.invalid',
		'/x/..//evil.invalid',
		'/\\evil.invalid',
		'/%2f%2fevil.invalid',
		'/login',
		'/logout',
		'/api/auth/error',
		'/\nheader'
	])
		expect(returnPath(value)).toBe('/');
	expect(returnPath('/course/note?q=1#heading')).toBe('/course/note?q=1#heading');
	expect(await loginPage('/"><script>alert(1)</script>', false).text()).not.toContain('<script>');
});
