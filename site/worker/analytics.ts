const endpoints = new Map([
	['/api/analytics/site/tracking-config/4', { method: 'GET', upstream: '/site/tracking-config/4' }],
	['/api/analytics/track', { method: 'POST', upstream: '/track' }],
	['/api/analytics/identify', { method: 'POST', upstream: '/identify' }]
]);

/** Public analytics relay; never forwards site authentication to Rybbit. */
export async function proxyAnalytics(request: Request, fetcher: typeof fetch = fetch) {
	const url = new URL(request.url);
	const endpoint = endpoints.get(url.pathname);
	if (!endpoint) return new Response('Not found', { status: 404 });
	if (request.method !== endpoint.method)
		return new Response('Method not allowed', { status: 405, headers: { Allow: endpoint.method } });
	const origin = request.headers.get('origin');
	if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site')
		return new Response('Forbidden', { status: 403 });

	let body: string | undefined;
	if (request.method === 'POST') {
		try {
			body = await request.text();
			const payload = JSON.parse(body);
			if (String(payload?.site_id) !== '4') return new Response('Invalid site', { status: 400 });
		} catch {
			return new Response('Invalid JSON', { status: 400 });
		}
	}

	// Preserve browser metadata for bot detection, without forwarding site credentials.
	const headers = new Headers();
	for (const [name, value] of request.headers) {
		if (
			['accept', 'accept-encoding', 'accept-language', 'user-agent', 'referer', 'origin'].includes(
				name
			) ||
			name.startsWith('sec-fetch-') ||
			name.startsWith('sec-ch-')
		)
			headers.set(name, value);
	}
	if (body !== undefined) headers.set('Content-Type', 'application/json');
	const ip = request.headers.get('cf-connecting-ip');
	if (ip) headers.set('X-Forwarded-For', ip);

	try {
		const response = await fetcher(`https://rybbit.twango.dev/api${endpoint.upstream}`, {
			method: endpoint.method,
			headers,
			body,
			redirect: 'error',
			signal: AbortSignal.timeout(5000)
		});
		return new Response(response.body, {
			status: response.status,
			headers: {
				'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
				'Cache-Control': 'no-store'
			}
		});
	} catch {
		return new Response('Analytics unavailable', {
			status: 502,
			headers: { 'Cache-Control': 'no-store' }
		});
	}
}
