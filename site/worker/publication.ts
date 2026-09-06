import { frameOptions } from './framing';

export type PublicAssets = Record<string, string>;

export function publicTarget(request: Request, assets: PublicAssets) {
	if (!['GET', 'HEAD'].includes(request.method)) return;
	const pathname = new URL(request.url).pathname;
	if (pathname.startsWith('/_published')) return;
	return Object.hasOwn(assets, pathname) ? assets[pathname] : undefined;
}

export function publicResponse(response: Response, request: Request) {
	const result = new Response(request.method === 'HEAD' ? null : response.body, response);
	result.headers.set('Cache-Control', 'no-store');
	result.headers.set('Vary', 'Cookie');
	result.headers.set('X-Content-Type-Options', 'nosniff');
	result.headers.set('Referrer-Policy', 'same-origin');
	result.headers.delete('Set-Cookie');
	result.headers.delete('X-Robots-Tag');
	const pathname = new URL(request.url).pathname;
	result.headers.set('X-Frame-Options', frameOptions(response));
	if (pathname.startsWith('/_files/') || pathname.includes('/files') || response.status >= 400)
		result.headers.set('X-Robots-Tag', 'noindex');
	if (/^\/_files\/blobs\/[a-f0-9]{64}\.bin$/.test(pathname)) {
		result.headers.set('Content-Type', 'application/octet-stream');
		result.headers.set('Content-Disposition', 'attachment');
	}
	return result;
}
