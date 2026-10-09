export interface AnalyticsOptions {
	siteId: string;
	endpoint: string;
}
/** Opt-in analytics relay; never forwards vault authentication upstream. */
export async function proxyAnalytics(
	request: Request,
	fetcher: typeof fetch = fetch,
	options?: AnalyticsOptions
) {
	if (!options) return new Response('Not found', { status: 404 });
	if (!/^[0-9]+$/.test(options.siteId))
		return new Response('Invalid analytics configuration', { status: 503 });
	let upstream: URL;
	try {
		upstream = new URL(options.endpoint);
		if (
			upstream.protocol !== 'https:' ||
			upstream.username ||
			upstream.password ||
			upstream.search ||
			upstream.hash
		)
			throw Error();
	} catch {
		return new Response('Invalid analytics configuration', { status: 503 });
	}
	const endpoints = new Map([
		[
			'/api/analytics/site/tracking-config/' + options.siteId,
			{ method: 'GET', upstream: '/site/tracking-config/' + options.siteId }
		],
		['/api/analytics/track', { method: 'POST', upstream: '/track' }],
		['/api/analytics/identify', { method: 'POST', upstream: '/identify' }]
	]);
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
			if (String(payload?.site_id) !== options.siteId)
				return new Response('Invalid site', { status: 400 });
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
		const response = await fetcher(upstream.href.replace(/\/$/, '') + endpoint.upstream, {
			method: endpoint.method,
			headers,
			body,
			redirect: 'manual',
			signal: AbortSignal.timeout(5000)
		});
		// workerd supports manual redirects, but not fetch's redirect: 'error' mode.
		if (response.status >= 300 && response.status < 400)
			return new Response('Analytics upstream redirected', {
				status: 502,
				headers: { 'Cache-Control': 'no-store' }
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
