export interface AssetBinding {
	fetch(request: Request): Promise<Response>;
}

export interface ContentContext {
	edition: 'public' | 'full';
	snapshot: string;
	applicationVersion: string;
}

export interface ContentDescriptor {
	schemaVersion: 1;
	applicationVersion: string;
	snapshots: Record<ContentContext['edition'], string>;
}

export interface ContentRouting {
	schemaVersion: 1;
	routes: string[];
	assets: Record<string, string>;
	/** Producer hashes all HTML inputs for an exact route; omission uses the whole snapshot. */
	htmlKeys?: Record<string, string>;
}

const digest = /^[a-f0-9]{64}$/;
const routingCaches = new WeakMap<AssetBinding, Map<string, Promise<ContentRouting>>>();

/** Internal content is accessible only through the trusted ASSETS binding. */
export function isInternalContentPath(pathname: string) {
	for (let attempt = 0; attempt < 4; attempt++) {
		pathname = pathname.replace(/\/+/g, '/');
		if (/^\/(?:_content|_published)(?:\/|$)/i.test(pathname)) return true;
		const normalized = new URL(pathname, 'https://content.invalid').pathname;
		if (/^\/(?:_content|_published)(?:\/|$)/i.test(normalized)) return true;
		try {
			const decoded = decodeURIComponent(pathname);
			if (decoded === pathname) return false;
			pathname = decoded;
		} catch {
			return true;
		}
	}
	return true;
}

async function internalJson(binding: AssetBinding, origin: string, pathname: string) {
	const response = await binding.fetch(new Request(new URL(pathname, origin)));
	if (response.status !== 200) throw new Error('Content snapshot unavailable');
	return response.json() as Promise<unknown>;
}

/** Re-read the small pointer: a new deployment cannot inherit an old isolate's pointer. */
export async function contentDescriptor(
	binding: AssetBinding,
	origin: string
): Promise<ContentDescriptor> {
	const value = (await internalJson(
		binding,
		origin,
		'/_content/current.json'
	)) as Partial<ContentDescriptor> | null;
	if (
		!value ||
		value.schemaVersion !== 1 ||
		typeof value.applicationVersion !== 'string' ||
		!digest.test(value.applicationVersion) ||
		typeof value.snapshots?.public !== 'string' ||
		!digest.test(value.snapshots.public) ||
		typeof value.snapshots?.full !== 'string' ||
		!digest.test(value.snapshots.full)
	)
		throw new Error('Invalid content snapshot descriptor');
	return value as ContentDescriptor;
}

export function contentContext(
	descriptor: ContentDescriptor,
	edition: ContentContext['edition']
): ContentContext {
	return {
		edition,
		snapshot: descriptor.snapshots[edition],
		applicationVersion: descriptor.applicationVersion
	};
}

function safePath(value: unknown): value is string {
	if (
		typeof value !== 'string' ||
		!value.startsWith('/') ||
		value.startsWith('//') ||
		value.includes('\\') ||
		/[\u0000-\u0020?#]/.test(value)
	)
		return false;
	const normalized = new URL(value, 'https://content.invalid');
	return normalized.pathname === value;
}

export async function contentRouting(
	binding: AssetBinding,
	origin: string,
	context: ContentContext
): Promise<ContentRouting> {
	let cache = routingCaches.get(binding);
	if (!cache) routingCaches.set(binding, (cache = new Map()));
	const key = `${context.edition}/${context.snapshot}`;
	let result = cache.get(key);
	if (!result) {
		result = (async () => {
			const value = (await internalJson(
				binding,
				origin,
				`/_content/${key}/routing.json`
			)) as Partial<ContentRouting> | null;
			if (
				!value ||
				value.schemaVersion !== 1 ||
				!Array.isArray(value.routes) ||
				!value.routes.every((route) => safePath(route) && !isInternalContentPath(route)) ||
				!value.assets ||
				typeof value.assets !== 'object' ||
				Array.isArray(value.assets) ||
				!Object.entries(value.assets).every(
					([route, target]) => safePath(route) && !isInternalContentPath(route) && safePath(target)
				) ||
				(value.htmlKeys !== undefined &&
					(!value.htmlKeys ||
						typeof value.htmlKeys !== 'object' ||
						Array.isArray(value.htmlKeys) ||
						!Object.entries(value.htmlKeys).every(
							([route, hash]) =>
								value.routes!.includes(route) && typeof hash === 'string' && digest.test(hash)
						)))
			)
				throw new Error('Invalid content routing inventory');
			return value as ContentRouting;
		})();
		cache.set(key, result);
		// Immutable snapshots can be memoized, but keep old deployments bounded.
		if (cache.size > 4) cache.delete(cache.keys().next().value!);
		result.catch(() => {
			if (cache!.get(key) === result) cache!.delete(key);
		});
	}
	return result;
}

export interface HtmlCache {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
}

export interface BackgroundContext {
	waitUntil(promise: Promise<unknown>): void;
}

export function versionedResponse(response: Response, context: ContentContext) {
	const result = new Response(response.body, response);
	result.headers.set('X-Wisconsin-Content-Version', context.snapshot);
	result.headers.set('X-Wisconsin-Application-Version', context.applicationVersion);
	return result;
}

function htmlRequest(request: Request, routing: ContentRouting) {
	const url = new URL(request.url);
	let pathname: string;
	try {
		pathname = decodeURIComponent(url.pathname);
	} catch {
		return false;
	}
	return (
		request.method === 'GET' &&
		url.search === '' &&
		!request.headers.has('range') &&
		!/(?:no-cache|no-store)/i.test(request.headers.get('cache-control') ?? '') &&
		!/^\/(?:api|admin|login|logout)(?:\/|$)/.test(pathname) &&
		!url.pathname.endsWith('/__data.json') &&
		routing.routes.includes(url.pathname)
	);
}

/** Called after authentication for full requests, before security headers/cookies are added. */
export async function cachedHtml(
	request: Request,
	context: ContentContext,
	routing: ContentRouting,
	cache: HtmlCache | undefined,
	background: BackgroundContext,
	render: () => Promise<Response>
) {
	if (!cache || !htmlRequest(request, routing)) return render();
	const url = new URL(request.url);
	const routeKey = routing.htmlKeys?.[url.pathname];
	const dependency = routeKey ? `dependency/${routeKey}` : `snapshot/${context.snapshot}`;
	url.pathname = `/_content/ssr/${context.applicationVersion}/${context.edition}/${dependency}/${encodeURIComponent(url.pathname)}`;
	const key = new Request(url, { method: 'GET' });
	try {
		const cached = await cache.match(key);
		if (cached) return cached;
	} catch {
		/* Cache availability must not become content availability. */
	}
	const response = await render();
	if (
		response.status === 200 &&
		response.headers.get('content-type')?.toLowerCase().includes('text/html') &&
		!/(?:private|no-cache|no-store)/i.test(response.headers.get('cache-control') ?? '') &&
		!response.headers.has('set-cookie') &&
		!response.headers.has('vary')
	) {
		const stored = response.clone();
		stored.headers.set('Cache-Control', 'public, max-age=3600');
		try {
			background.waitUntil(
				Promise.resolve()
					.then(() => cache.put(key, stored))
					.catch(() => undefined)
			);
		} catch {
			/* A closed background context cannot turn a rendered page into an error. */
		}
	}
	return response;
}
