import { createAuth, isOwner, type AuthEnv } from './auth';
import { loginPage, returnPath } from './login';

const publicAuthPaths = new Set([
	'/api/auth/sign-in/social',
	'/api/auth/callback/github',
	'/api/auth/get-session',
	'/api/auth/sign-out',
	'/api/auth/error'
]);

function privateResponse(response: Response, cookies?: Headers) {
	const result = new Response(response.body, response);
	result.headers.set('Cache-Control', 'private, no-store');
	result.headers.set('X-Content-Type-Options', 'nosniff');
	result.headers.set('X-Frame-Options', 'DENY');
	result.headers.set('Referrer-Policy', 'same-origin');
	result.headers.set('X-Robots-Tag', 'noindex, nofollow');
	for (const cookie of cookies?.getSetCookie() ?? []) result.headers.append('Set-Cookie', cookie);
	return result;
}

function redirect(path: string) {
	return new Response(null, { status: 303, headers: { Location: path } });
}

export async function authenticateRequest(
	request: Request,
	env: AuthEnv,
	serve: () => Promise<Response>
) {
	try {
		const url = new URL(request.url);
		if (url.origin !== env.ORIGIN)
			return privateResponse(new Response('Misdirected request', { status: 421 }));
		const auth = createAuth(env);
		if (url.pathname.startsWith('/api/auth/')) {
			if (!publicAuthPaths.has(url.pathname))
				return privateResponse(new Response('Not found', { status: 404 }));
			if (url.pathname === '/api/auth/error') return privateResponse(redirect('/login?error=1'));
			return privateResponse(await auth.handler(request));
		}
		if ((url.pathname === '/login' || url.pathname === '/logout') && request.method === 'POST') {
			if (
				request.headers.get('origin') !== env.ORIGIN ||
				request.headers.get('sec-fetch-site') === 'cross-site'
			) {
				return privateResponse(new Response('Forbidden', { status: 403 }));
			}
			const login = url.pathname === '/login';
			const next = login ? returnPath((await request.formData()).get('next')) : '/login';
			const headers = new Headers(request.headers);
			headers.set('Content-Type', 'application/json');
			headers.delete('content-length');
			const response = await auth.handler(
				new Request(
					new URL(login ? '/api/auth/sign-in/social' : '/api/auth/sign-out', env.ORIGIN),
					{
						method: 'POST',
						headers,
						body: JSON.stringify(
							login
								? { provider: 'github', callbackURL: next, errorCallbackURL: '/login?error=1' }
								: {}
						)
					}
				)
			);
			if (!response.ok) {
				const page = loginPage(next, true);
				const result = new Response(page.body, { status: response.status, headers: page.headers });
				const retryAfter = response.headers.get('x-retry-after');
				if (retryAfter) result.headers.set('Retry-After', retryAfter);
				return privateResponse(result, response.headers);
			}
			const data = login ? ((await response.json()) as { url: string }) : null;
			return privateResponse(redirect(data?.url ?? '/login'), response.headers);
		}
		const { headers, response: session } = await auth.api.getSession({
			headers: request.headers,
			returnHeaders: true
		});
		const allowed = session && (await isOwner(env.DB, session.user.id, env.OWNER_GITHUB_ID));
		if (url.pathname === '/login' && (request.method === 'GET' || request.method === 'HEAD')) {
			const next = returnPath(url.searchParams.get('next'));
			const response = allowed ? redirect(next) : loginPage(next, url.searchParams.has('error'));
			return privateResponse(
				request.method === 'HEAD' ? new Response(null, response) : response,
				headers
			);
		}
		if (!allowed) {
			const navigation =
				request.method === 'GET' &&
				(request.headers.get('sec-fetch-mode') === 'navigate' ||
					request.headers.get('accept')?.includes('text/html'));
			return privateResponse(
				navigation
					? redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`)
					: new Response('Unauthorized', { status: 401 }),
				headers
			);
		}
		return privateResponse(await serve(), headers);
	} catch {
		console.error('Authentication request failed');
		return privateResponse(new Response('Authentication temporarily unavailable', { status: 503 }));
	}
}
