import type { createAuth } from './auth';
import { loginPage, returnPath } from './login';

type Auth = ReturnType<typeof createAuth>;

const endpoints = new Set([
	'/api/auth/sign-in/social',
	'/api/auth/callback/github',
	'/api/auth/get-session',
	'/api/auth/sign-out',
	'/api/auth/error'
]);

export function copyCookies(source: Headers, target: Headers) {
	for (const cookie of source.getSetCookie()) target.append('Set-Cookie', cookie);
}

export function redirect(location: string, cookies?: Headers) {
	const headers = new Headers({ Location: location });
	if (cookies) copyCookies(cookies, headers);
	return new Response(null, { status: 303, headers });
}

export function handleAuthEndpoint(request: Request, auth: Auth) {
	const { pathname } = new URL(request.url);
	if (!endpoints.has(pathname)) return new Response('Not found', { status: 404 });
	if (pathname === '/api/auth/error') return redirect('/login?error=1');
	return auth.handler(request);
}

function sameOrigin(request: Request) {
	return (
		request.headers.get('origin') === new URL(request.url).origin &&
		request.headers.get('sec-fetch-site') !== 'cross-site'
	);
}

function postAuth(request: Request, auth: Auth, path: string, body: object) {
	const headers = new Headers(request.headers);
	headers.set('Content-Type', 'application/json');
	headers.delete('content-length');
	return auth.handler(
		new Request(new URL(path, request.url), {
			method: 'POST',
			headers,
			body: JSON.stringify(body)
		})
	);
}

function formError(response: Response, next: string) {
	const page = loginPage(next, true);
	const result = new Response(page.body, { status: response.status, headers: page.headers });
	const retryAfter = response.headers.get('x-retry-after');
	if (retryAfter) result.headers.set('Retry-After', retryAfter);
	copyCookies(response.headers, result.headers);
	return result;
}

export async function signIn(request: Request, auth: Auth) {
	if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 });
	const next = returnPath((await request.formData()).get('next'));
	const response = await postAuth(request, auth, '/api/auth/sign-in/social', {
		provider: 'github',
		callbackURL: next,
		errorCallbackURL: '/login?error=1'
	});
	if (!response.ok) return formError(response, next);
	const { url } = (await response.json()) as { url: string };
	return redirect(url, response.headers);
}

export async function signOut(request: Request, auth: Auth) {
	if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 });
	const response = await postAuth(request, auth, '/api/auth/sign-out', {});
	if (!response.ok) return formError(response, '/login');
	return redirect('/login', response.headers);
}
