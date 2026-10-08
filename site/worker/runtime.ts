import { authenticateRequest } from './gate';
import type { AuthEnv } from './auth';
import { isFileBrowserPath } from './publication';
import {
	cachedHtml,
	contentContext,
	contentDescriptor,
	contentRouting,
	versionedResponse,
	type AssetBinding,
	type BackgroundContext,
	type ContentContext,
	type HtmlCache
} from './content-runtime';

export interface RuntimeEnv extends AuthEnv {
	ASSETS: AssetBinding;
	WISCONSIN_CONTENT_CONTEXT?: ContentContext;
}

export interface RuntimeApp {
	fetch(request: Request, env: RuntimeEnv, context: BackgroundContext): Promise<Response>;
}

/** Preserve file transfer semantics without forwarding session or authorization headers. */
export function assetAliasRequest(request: Request, target?: string) {
	const url = new URL(request.url);
	url.pathname = target ?? url.pathname;
	url.search = '';
	const headers = new Headers();
	for (const name of [
		'range',
		'if-range',
		'if-none-match',
		'if-modified-since',
		'if-match',
		'if-unmodified-since'
	]) {
		const value = request.headers.get(name);
		if (value !== null) headers.set(name, value);
	}
	return new Request(url, { method: request.method, headers });
}

export function createContentWorker(app: RuntimeApp, cache?: HtmlCache) {
	return {
		fetch(request: Request, env: RuntimeEnv, background: BackgroundContext) {
			const url = new URL(request.url);
			let pointer: ReturnType<typeof contentDescriptor> | undefined;
			const descriptor = () => (pointer ??= contentDescriptor(env.ASSETS, url.origin));
			async function serve(edition: ContentContext['edition'], published: boolean) {
				const context = contentContext(await descriptor(), edition);
				const routing = await contentRouting(env.ASSETS, url.origin, context);
				const reading = request.method === 'GET' || request.method === 'HEAD';
				const routePath = url.pathname.endsWith('/__data.json')
					? url.pathname.slice(0, -'/__data.json'.length) || '/'
					: url.pathname.replace(/\/$/, '') || '/';
				const route = routing.routes.includes(routePath);
				const target = Object.hasOwn(routing.assets, url.pathname)
					? routing.assets[url.pathname]
					: undefined;
				if (published && (!reading || (!route && !target)))
					return isFileBrowserPath(url.pathname)
						? new Response('Not found', { status: 404 })
						: null;
				if (reading && !route) {
					if (isFileBrowserPath(url.pathname) && !target)
						return new Response('Not found', { status: 404 });
					const response = await env.ASSETS.fetch(assetAliasRequest(request, target));
					if (
						published &&
						response.status >= 300 &&
						response.status < 400 &&
						response.status !== 304
					)
						return new Response('Publication unavailable', { status: 503 });
					if (response.status !== 404 || published) return versionedResponse(response, context);
				}
				// Trust is carried in an object supplied by this Worker, never a request field.
				const trustedEnv = { ...env, WISCONSIN_CONTENT_CONTEXT: context };
				return versionedResponse(
					await cachedHtml(request, context, routing, cache, background, () =>
						app.fetch(request, trustedEnv, background)
					),
					context
				);
			}
			return authenticateRequest(
				request,
				env,
				async () => {
					// The login page's maintained font is independent of course snapshots.
					if (
						['GET', 'HEAD'].includes(request.method) &&
						url.pathname === '/fonts/OverusedGrotesk-VF.woff2'
					)
						return env.ASSETS.fetch(request);
					return (await serve('full', false))!;
				},
				() => serve('public', true)
			);
		}
	};
}
