import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { betterAuth } from 'better-auth';
import { testUtils } from 'better-auth/plugins';
import { getMigrations } from 'better-auth/db/migration';
import { createAuth, isOwner, type AuthEnv } from '../../worker/auth';
import { authenticateRequest } from '../../worker/gate';
import { loginPage, returnPath } from '../../worker/login';
import { revokeAccess } from '../../src/lib/server/access-admin';

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
		const statements = readdirSync('migrations')
			.filter((file) => file.endsWith('.sql'))
			.sort()
			.map((file) => readFileSync(`migrations/${file}`, 'utf8'))
			.join('\n')
			.split(';')
			.map((s) => s.trim())
			.filter(Boolean);
		await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
		const auth = betterAuth({
			...createAuth(env).options,
			database: env.DB,
			plugins: [testUtils()]
		});
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
		const migration = await getMigrations({ ...createAuth(env).options, database: env.DB });
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
	test('published content bypasses authentication without opening the full collection', async () => {
		let privateCalls = 0;
		const serve = async () => {
			privateCalls++;
			return new Response('private');
		};
		const published = await authenticateRequest(
			new Request(origin + '/public-note'),
			{ ...env, DB: undefined! },
			serve,
			async () => new Response('public')
		);
		expect(await published.text()).toBe('public');
		expect(published.headers.get('x-robots-tag')).toBeNull();
		expect(privateCalls).toBe(0);
		const missing = await authenticateRequest(
			new Request(origin + '/private-note'),
			env,
			serve,
			async () => null
		);
		expect(missing.status).toBe(401);
		expect(privateCalls).toBe(0);
		const forbiddenOrigin = await authenticateRequest(
			new Request('https://wrong.invalid/public-note'),
			env,
			serve,
			async () => new Response('public')
		);
		expect(forbiddenOrigin.status).toBe(421);
		const internal = await authenticateRequest(
			new Request(origin + '/_published/public-note'),
			env,
			serve,
			async () => new Response('public')
		);
		expect(internal.status).toBe(404);
	});
	test('unrelated or invalid cookies do not prevent reading public content', async () => {
		for (const cookie of ['theme=dark', 'better-auth.session_token=invalid']) {
			const response = await authenticateRequest(
				new Request(origin + '/public-note', { headers: { cookie } }),
				env,
				async () => new Response('private'),
				async () => new Response('public')
			);
			expect(await response.text()).toBe('public');
			expect(response.headers.get('set-cookie')).toBeNull();
		}
	});
	test('login is public and contains no course bundles', async () => {
		const response = await request('/login');
		const html = await response.text();
		expect(response.status).toBe(200);
		expect(html).toContain('Continue with GitHub');
		expect(html).not.toMatch(/_app|pagefind|graph.json|<script src/);
		const nonce = html.match(/<script nonce="([^"]+)"/)?.[1];
		expect(nonce).toBeTruthy();
		expect(response.headers.get('content-security-policy')).toContain(`'nonce-${nonce}'`);
	});
	test('owner sessions permit assets without public caching', async () => {
		const response = await request('/graph.json', { headers: { cookie } });
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('private course content');
		expect(response.headers.get('cache-control')).toBe('private, no-store');
	});
	test('PDF embeds remain authenticated and allow same-origin framing for both URL forms', async () => {
		for (const path of [
			'/sp26-cs537/exams/midterm-1/assets/cheatsheet.pdf',
			`/_files/blobs/${'a'.repeat(64)}.pdf`
		]) {
			let servedPdf = false;
			const serve = async () => {
				servedPdf = true;
				return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } });
			};
			const anonymous = await authenticateRequest(new Request(origin + path), env, serve);
			expect(anonymous.status).toBe(401);
			expect(anonymous.headers.get('X-Frame-Options')).toBe('DENY');
			expect(servedPdf).toBe(false);
			const member = await authenticateRequest(
				new Request(origin + path, { headers: { cookie } }),
				env,
				serve
			);
			expect(member.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
			expect(member.headers.get('Cache-Control')).toBe('private, no-store');
			expect(await member.text()).toStartWith('%PDF');
		}
	});
	test('sessions remain compatible across the native D1 and Drizzle adapters', async () => {
		const drizzle = betterAuth({ ...createAuth(env).options, plugins: [testUtils()] });
		const native = betterAuth({ ...createAuth(env).options, database: env.DB });
		const headers = new Headers({ cookie });
		const before = await native.api.getSession({ headers });
		const after = await drizzle.api.getSession({ headers });
		expect(after?.user.id).toBe(userId);
		expect(after?.session.expiresAt).toEqual(before?.session.expiresAt);
		const ctx = await drizzle.$context;
		const login = await ctx.test.login({ userId });
		expect((await native.api.getSession({ headers: login.headers }))?.user.id).toBe(userId);
		const stored = await env.DB.prepare('SELECT createdAt FROM session WHERE token = ?')
			.bind(login.token)
			.first<{ createdAt: string }>();
		expect(typeof stored?.createdAt).toBe('string');
		expect(new Date(stored!.createdAt).toISOString()).toBe(stored!.createdAt);
	});
	test('content failures are distinct from authentication failures', async () => {
		const response = await authenticateRequest(
			new Request(origin + '/graph.json', { headers: { cookie } }),
			env,
			async () => {
				throw new Error('Asset storage unavailable');
			}
		);
		expect(response.status).toBe(500);
		expect(await response.text()).toBe('Content temporarily unavailable');
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
	test('allowlisted members can read content but lose access immediately when removed', async () => {
		await env.DB.prepare(
			'INSERT INTO siteAccess (githubId, githubLogin, createdAt) VALUES (?, ?, ?)'
		)
			.bind('12345', 'member', Date.now())
			.run();
		const auth = betterAuth({ ...createAuth(env).options, plugins: [testUtils()] });
		const ctx = await auth.$context;
		const user = await ctx.test.saveUser(ctx.test.createUser());
		await ctx.internalAdapter.createAccount({
			userId: user.id,
			providerId: 'github',
			issuer: 'local:oauth:github',
			accountId: '12345'
		});
		const member = await ctx.test.login({ userId: user.id });
		const headers = member.headers;
		expect((await request('/graph.json', { headers })).status).toBe(200);
		expect(await (await request('/api/access', { headers })).json()).toEqual({ role: 'member' });
		expect(await isOwner(env.DB, user.id, env.OWNER_GITHUB_ID)).toBe(false);
		await env.DB.prepare(
			"CREATE TRIGGER fail_revoke BEFORE DELETE ON session BEGIN SELECT RAISE(ABORT, 'test rollback'); END"
		).run();
		try {
			await expect(revokeAccess(env, '12345')).rejects.toThrow();
			expect((await request('/graph.json', { headers })).status).toBe(200);
		} finally {
			await env.DB.prepare('DROP TRIGGER fail_revoke').run();
		}
		await revokeAccess(env, '12345');
		expect(
			await env.DB.prepare('SELECT id FROM session WHERE userId = ?').bind(user.id).first()
		).toBeNull();
		expect((await request('/graph.json', { headers })).status).toBe(401);
		expect((await request('/api/access', { headers })).status).toBe(401);
		expect(
			await auth.options.socialProviders.github
				.mapProfileToUser({ id: 12345 } as never)
				.catch(() => null)
		).toBeNull();
	});
	test('owner access cannot be revoked', async () => {
		await expect(revokeAccess(env, env.OWNER_GITHUB_ID)).rejects.toMatchObject({ status: 400 });
		expect((await request('/graph.json', { headers: { cookie } })).status).toBe(200);
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
	test('GitHub OAuth admits owners and approved members, but rejects other accounts', async () => {
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
			await env.DB.prepare('INSERT INTO siteAccess VALUES (?, ?, ?)')
				.bind('24', 'test-member', Date.now())
				.run();
			for (const id of [22, 24, 23]) {
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
				expect(protectedResponse.status).toBe(id !== 23 ? 200 : 401);
				if (id !== 23) {
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
