import { createAuth, type AuthEnv } from './auth';
import { accessForUser } from './access';
import { copyCookies, handleAuthEndpoint, redirect, signIn, signOut } from './auth-routes';
import { loginPage, returnPath } from './login';
import { publicResponse } from './publication';

function privateResponse(response: Response, cookies: Headers, request: Request) {
	const result = new Response(response.body, response);
	const pathname = new URL(request.url).pathname;
	const embeddedPdf = /^\/_files\/blobs\/[a-f0-9]{64}\.pdf$/.test(pathname);
	result.headers.set('Cache-Control', 'private, no-store');
	result.headers.set('X-Content-Type-Options', 'nosniff');
	result.headers.set('X-Frame-Options', embeddedPdf ? 'SAMEORIGIN' : 'DENY');
	if (/^\/_files\/blobs\/[a-f0-9]{64}\.bin$/.test(pathname)) {
		result.headers.set('Content-Type', 'application/octet-stream');
		result.headers.set('Content-Disposition', 'attachment');
	}
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
	cookies: Headers,
	servePublic?: () => Promise<Response | null>
): Promise<Response | null> {
	const url = new URL(request.url);
	if (url.origin !== env.ORIGIN) return new Response('Misdirected request', { status: 421 });
	const reading = request.method === 'GET' || request.method === 'HEAD';
	if (url.pathname === '/_published' || url.pathname.startsWith('/_published/'))
		return new Response('Not found', { status: 404 });
	if (
		reading &&
		servePublic &&
		(!request.headers.has('cookie') ||
			['/sitemap.xml', '/index.xml', '/robots.txt'].includes(url.pathname))
	) {
		const published = await servePublic();
		if (published) return published;
	}
	const auth = createAuth(env);
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
	if (!access)
		return reading && servePublic
			? ((await servePublic()) ?? requireLogin(request, url))
			: requireLogin(request, url);
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
	serve: () => Promise<Response>,
	servePublic?: () => Promise<Response | null>
) {
	const cookies = new Headers();
	let published = false;
	const publication =
		servePublic &&
		(async () => {
			const response = await servePublic();
			if (response) published = true;
			return response;
		});
	let response: Response | null;
	try {
		response = await routeRequest(request, env, cookies, publication);
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
	return published
		? publicResponse(response, request)
		: privateResponse(response, cookies, request);
}
