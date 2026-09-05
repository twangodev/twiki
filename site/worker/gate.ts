import { createAuth, type AuthEnv } from './auth';
import { accessForUser } from './access';
import { copyCookies, handleAuthEndpoint, redirect, signIn, signOut } from './auth-routes';
import { loginPage, returnPath } from './login';

function privateResponse(response: Response, cookies: Headers) {
	const result = new Response(response.body, response);
	result.headers.set('Cache-Control', 'private, no-store');
	result.headers.set('X-Content-Type-Options', 'nosniff');
	result.headers.set('X-Frame-Options', 'DENY');
	result.headers.set('Referrer-Policy', 'same-origin');
	result.headers.set('X-Robots-Tag', 'noindex, nofollow');
	copyCookies(cookies, result.headers);
	return result;
}

function requireLogin(request: Request, url: URL) {
	const navigation =
		request.method === 'GET' &&
		(request.headers.get('sec-fetch-mode') === 'navigate' ||
			request.headers.get('accept')?.includes('text/html'));
	if (navigation) return redirect('/login?next=' + encodeURIComponent(url.pathname + url.search));
	return new Response('Unauthorized', { status: 401 });
}

async function routeRequest(
	request: Request,
	env: AuthEnv,
	cookies: Headers
): Promise<Response | null> {
	const url = new URL(request.url);
	if (url.origin !== env.ORIGIN) return new Response('Misdirected request', { status: 421 });
	const auth = createAuth(env);
	const reading = request.method === 'GET' || request.method === 'HEAD';
	if (reading && url.pathname === '/fonts/OverusedGrotesk-VF.woff2') return null;
	if (url.pathname.startsWith('/api/auth/')) return handleAuthEndpoint(request, auth);
	if (request.method === 'POST') {
		if (url.pathname === '/login') return signIn(request, auth);
		if (url.pathname === '/logout') return signOut(request, auth);
	}

	const { headers, response: session } = await auth.api.getSession({
		headers: request.headers,
		returnHeaders: true
	});
	copyCookies(headers, cookies);
	const access = session && (await accessForUser(env, session.user.id));
	if (reading && url.pathname === '/login') {
		const next = returnPath(url.searchParams.get('next'));
		if (access) return redirect(next);
		const page = loginPage(next, url.searchParams.has('error'));
		return request.method === 'HEAD' ? new Response(null, page) : page;
	}
	if (!access) return requireLogin(request, url);
	if (url.pathname === '/api/access') {
		if (!reading) return new Response('Method not allowed', { status: 405 });
		return new Response(request.method === 'HEAD' ? null : JSON.stringify({ role: access }), {
			headers: { 'Content-Type': 'application/json' }
		});
	}
	return null;
}

export async function authenticateRequest(
	request: Request,
	env: AuthEnv,
	serve: () => Promise<Response>
) {
	const cookies = new Headers();
	let response: Response | null;
	try {
		response = await routeRequest(request, env, cookies);
	} catch {
		console.error('Authentication request failed');
		response = new Response('Authentication temporarily unavailable', { status: 503 });
	}
	if (response === null) {
		try {
			response = await serve();
		} catch {
			console.error('Content request failed');
			response = new Response('Content temporarily unavailable', { status: 500 });
		}
	}
	return privateResponse(response, cookies);
}
