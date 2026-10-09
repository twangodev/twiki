import { describe, expect, test } from 'bun:test';
import {
	cachedHtml,
	contentDescriptor,
	contentRouting,
	isInternalContentPath,
	type AssetBinding,
	type ContentContext,
	type ContentDescriptor,
	type ContentRouting,
	type HtmlCache
} from '../../worker/content-runtime';
import { assetAliasRequest, createContentWorker, type RuntimeEnv } from '../../worker/runtime';

const origin = 'https://content.test';
const publicSnapshot = 'a'.repeat(64);
const fullSnapshot = 'b'.repeat(64);
const applicationVersion = 'c'.repeat(64);
const descriptor: ContentDescriptor = {
	schemaVersion: 1,
	applicationVersion,
	snapshots: { public: publicSnapshot, full: fullSnapshot }
};
const routing: ContentRouting = {
	schemaVersion: 1,
	routes: ['/', '/note', '/course/files/readme'],
	assets: { '/image.png': '/_published/image.png' }
};
const publicContext: ContentContext = {
	edition: 'public',
	snapshot: publicSnapshot,
	applicationVersion
};
const context = { waitUntil: (_promise: Promise<unknown>) => {} };

function memoryCache() {
	const values = new Map<string, Response>();
	const keys: string[] = [];
	const cache: HtmlCache = {
		async match(request) {
			keys.push(request.url);
			return values.get(request.url)?.clone();
		},
		async put(request, response) {
			values.set(request.url, response.clone());
		}
	};
	return { cache, keys, values };
}

describe('trusted Worker content snapshots', () => {
	test('asset aliases preserve range and conditional GET/HEAD semantics without credentials', async () => {
		const etag = '"image-v1"';
		const modified = 'Wed, 07 Oct 2026 12:00:00 GMT';
		const seen: Request[] = [];
		const binding: AssetBinding = {
			async fetch(request) {
				const pathname = new URL(request.url).pathname;
				if (pathname === '/_content/current.json') return Response.json(descriptor);
				if (pathname.startsWith('/_content/')) return Response.json(routing);
				seen.push(request);
				if (request.headers.get('if-none-match') === etag)
					return new Response(null, { status: 304, headers: { ETag: etag } });
				if (
					request.headers.get('range') === 'bytes=2-4' &&
					request.headers.get('if-range') === etag
				)
					return new Response('234', {
						status: 206,
						headers: { 'Content-Range': 'bytes 2-4/10', ETag: etag }
					});
				return new Response('0123456789');
			}
		};
		const worker = createContentWorker({
			async fetch() {
				throw new Error('Must not render an asset');
			}
		});
		const env = { ORIGIN: origin, ASSETS: binding } as unknown as RuntimeEnv;
		const ranged = await worker.fetch(
			new Request(origin + '/image.png?download=true', {
				headers: { Range: 'bytes=2-4', 'If-Range': etag, Authorization: 'Bearer ignored' }
			}),
			env,
			context
		);
		expect(ranged.status).toBe(206);
		expect(await ranged.text()).toBe('234');
		expect(ranged.headers.get('Content-Range')).toBe('bytes 2-4/10');
		expect(seen[0].url).toBe(origin + '/_published/image.png');
		expect(seen[0].headers.has('Authorization')).toBe(false);
		const unchanged = await worker.fetch(
			new Request(origin + '/image.png', {
				method: 'HEAD',
				headers: { 'If-None-Match': etag, 'If-Modified-Since': modified }
			}),
			env,
			context
		);
		expect(unchanged.status).toBe(304);
		expect(await unchanged.text()).toBe('');
		expect(seen[1].method).toBe('HEAD');
		expect(seen[1].headers.get('If-Modified-Since')).toBe(modified);
		const forwarded = assetAliasRequest(
			new Request(origin + '/image.png', {
				headers: {
					Cookie: 'session=private',
					Authorization: 'Bearer private',
					'If-Match': etag,
					'If-Unmodified-Since': modified
				}
			}),
			'/_published/image.png'
		);
		expect(forwarded.headers.has('Cookie')).toBe(false);
		expect(forwarded.headers.has('Authorization')).toBe(false);
		expect(forwarded.headers.get('If-Match')).toBe(etag);
		expect(forwarded.headers.get('If-Unmodified-Since')).toBe(modified);
	});
	test('ordinary encoded filenames remain accessible while internal path escapes are rejected', () => {
		for (const pathname of [
			'/course/files/assets/Pasted%20image.png',
			'/course/files/a%20b%20c.pdf',
			'/course/files/%E6%95%B0%E5%AD%A6.pdf',
			'/course/files/notes%23one.md',
			'/course/files/notes%2520one.md'
		])
			expect(isInternalContentPath(pathname)).toBe(false);
		for (const pathname of [
			'/_content/current.json',
			'/%5fcontent/current.json',
			'/%255fcontent/current.json',
			'/foo%2f..%2f_content/current.json',
			'/foo%5c..%5c_content/current.json',
			'/%5fpublished/note',
			'/_content%23fake/current.json',
			'/%252525255fcontent/current.json'
		])
			expect(isInternalContentPath(pathname)).toBe(true);
	});
	test('the login font does not require content pointers or authentication storage', async () => {
		const paths: string[] = [];
		const worker = createContentWorker({
			async fetch() {
				throw new Error('Must not render');
			}
		});
		const env = {
			ORIGIN: origin,
			ASSETS: {
				async fetch(request: Request) {
					paths.push(new URL(request.url).pathname);
					return new Response('font', { headers: { 'Content-Type': 'font/woff2' } });
				}
			}
		} as unknown as RuntimeEnv;
		const response = await worker.fetch(
			new Request(origin + '/fonts/OverusedGrotesk-VF.woff2'),
			env,
			context
		);
		expect(response.status).toBe(200);
		expect(response.headers.has('X-Wisconsin-Content-Version')).toBe(false);
		expect(paths).toEqual(['/fonts/OverusedGrotesk-VF.woff2']);
	});
	test('all internal endpoints fail before assets or authentication for every reader', async () => {
		let fetched = 0;
		const worker = createContentWorker({
			async fetch() {
				throw new Error('Must not render');
			}
		});
		const env = {
			ORIGIN: origin,
			ASSETS: {
				async fetch() {
					fetched++;
					throw new Error('Must not fetch');
				}
			}
		} as unknown as RuntimeEnv;
		for (const pathname of [
			'/_content/current.json',
			'/_content/full/a/pages/note.json',
			'/%5fcontent/current.json',
			'/%255fcontent/current.json',
			'/_published/note',
			'/foo%2f..%2f_content/current.json'
		]) {
			for (const method of ['GET', 'HEAD', 'POST']) {
				const response = await worker.fetch(
					new Request(origin + pathname, { method, headers: { cookie: 'session=owner' } }),
					env,
					context
				);
				expect(response.status).toBe(404);
			}
		}
		expect(fetched).toBe(0);
		expect(isInternalContentPath('/note')).toBe(false);
		expect(isInternalContentPath('/%invalid')).toBe(true);
	});

	test('descriptor is refreshed, immutable inventories are bounded and failed reads retry', async () => {
		let pointer = descriptor;
		let reads = 0;
		let failRouting = true;
		const binding: AssetBinding = {
			async fetch(request) {
				if (new URL(request.url).pathname === '/_content/current.json') {
					reads++;
					return Response.json(pointer);
				}
				if (failRouting) return new Response('Unavailable', { status: 503 });
				return Response.json(routing);
			}
		};
		expect((await contentDescriptor(binding, origin)).snapshots.public).toBe(publicSnapshot);
		pointer = { ...descriptor, snapshots: { ...descriptor.snapshots, public: 'd'.repeat(64) } };
		expect((await contentDescriptor(binding, origin)).snapshots.public).toBe('d'.repeat(64));
		expect(reads).toBe(2);
		await expect(contentRouting(binding, origin, publicContext)).rejects.toThrow('unavailable');
		failRouting = false;
		expect((await contentRouting(binding, origin, publicContext)).routes).toContain('/note');
		const malformed: AssetBinding = {
			async fetch() {
				return Response.json({
					...descriptor,
					snapshots: { public: '../full', full: fullSnapshot }
				});
			}
		};
		await expect(contentDescriptor(malformed, origin)).rejects.toThrow('Invalid');
	});

	test('public SSR and Svelte data receive only Worker-selected context and no cookies', async () => {
		const seen: ContentContext[] = [];
		const binding: AssetBinding = {
			async fetch(request) {
				const pathname = new URL(request.url).pathname;
				return Response.json(pathname === '/_content/current.json' ? descriptor : routing);
			}
		};
		const worker = createContentWorker({
			async fetch(_request, env) {
				seen.push(env.WISCONSIN_CONTENT_CONTEXT!);
				return new Response('public note', {
					headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'renderer-cookie=discarded' }
				});
			}
		});
		const env = {
			ORIGIN: origin,
			ASSETS: binding,
			WISCONSIN_CONTENT_CONTEXT: { edition: 'full', snapshot: fullSnapshot, applicationVersion }
		} as unknown as RuntimeEnv;
		for (const pathname of [
			'/note?edition=full&snapshot=' + fullSnapshot,
			'/note/__data.json?x-sveltekit-invalidated=11',
			'/course/files/readme/__data.json'
		]) {
			const response = await worker.fetch(
				new Request(origin + pathname, { headers: { 'x-content-edition': 'full' } }),
				env,
				context
			);
			expect(await response.text()).toBe('public note');
			expect(response.headers.get('Set-Cookie')).toBeNull();
			expect(response.headers.get('Cache-Control')).toBe('no-store');
			expect(response.headers.get('X-Wisconsin-Content-Version')).toBe(publicSnapshot);
			expect(response.headers.get('X-Wisconsin-Application-Version')).toBe(applicationVersion);
		}
		expect(seen).toEqual([publicContext, publicContext, publicContext]);
	});

	test('failed authorization cannot consult full SSR cache', async () => {
		const memory = memoryCache();
		const binding: AssetBinding = {
			async fetch(request) {
				return Response.json(
					new URL(request.url).pathname === '/_content/current.json'
						? descriptor
						: { ...routing, routes: ['/'] }
				);
			}
		};
		let rendered = 0;
		const worker = createContentWorker(
			{
				async fetch() {
					rendered++;
					return new Response('private');
				}
			},
			memory.cache
		);
		const response = await worker.fetch(
			new Request(origin + '/private-note'),
			{ ORIGIN: origin, ASSETS: binding } as unknown as RuntimeEnv,
			context
		);
		expect(response.status).toBe(503);
		expect(memory.keys).toHaveLength(0);
		expect(rendered).toBe(0);
	});
	test('routing dependency keys reject malformed hashes and routes outside the inventory', async () => {
		for (const htmlKeys of [{ '/note': 'invalid' }, { '/unknown': 'd'.repeat(64) }, [], null]) {
			const binding: AssetBinding = {
				async fetch() {
					return Response.json({ ...routing, htmlKeys });
				}
			};
			await expect(contentRouting(binding, origin, publicContext)).rejects.toThrow(
				'Invalid content routing'
			);
		}
		const binding: AssetBinding = {
			async fetch() {
				return Response.json({ ...routing, htmlKeys: { '/note': 'd'.repeat(64) } });
			}
		};
		expect((await contentRouting(binding, origin, publicContext)).htmlKeys?.['/note']).toBe(
			'd'.repeat(64)
		);
	});
	test('unchanged route dependencies reuse HTML across snapshots with fresh version headers', async () => {
		const memory = memoryCache();
		let pointer = descriptor;
		let key = 'd'.repeat(64);
		let renders = 0;
		const pending: Promise<unknown>[] = [];
		const binding: AssetBinding = {
			async fetch(request) {
				return Response.json(
					new URL(request.url).pathname === '/_content/current.json'
						? pointer
						: { ...routing, htmlKeys: { '/note': key } }
				);
			}
		};
		const worker = createContentWorker(
			{
				async fetch() {
					renders++;
					return new Response('unchanged note', { headers: { 'Content-Type': 'text/html' } });
				}
			},
			memory.cache
		);
		const env = { ORIGIN: origin, ASSETS: binding } as unknown as RuntimeEnv;
		const background = {
			waitUntil(promise: Promise<unknown>) {
				pending.push(promise);
			}
		};
		const request = new Request(origin + '/note');
		const first = await worker.fetch(request, env, background);
		expect(await first.text()).toBe('unchanged note');
		await Promise.all(pending);
		pointer = { ...descriptor, snapshots: { ...descriptor.snapshots, public: 'e'.repeat(64) } };
		const reused = await worker.fetch(request, env, background);
		expect(await reused.text()).toBe('unchanged note');
		expect(reused.headers.get('X-Wisconsin-Content-Version')).toBe('e'.repeat(64));
		expect(reused.headers.get('X-Wisconsin-Application-Version')).toBe(applicationVersion);
		expect(reused.headers.get('Cache-Control')).toBe('no-store');
		expect(renders).toBe(1);
		key = 'f'.repeat(64);
		pointer = { ...descriptor, snapshots: { ...descriptor.snapshots, public: '1'.repeat(64) } };
		await worker.fetch(request, env, background);
		expect(renders).toBe(2);
		await cachedHtml(
			request,
			{ ...publicContext, edition: 'full' },
			{ ...routing, htmlKeys: { '/note': 'd'.repeat(64) } },
			memory.cache,
			background,
			async () => {
				renders++;
				return new Response('private', { headers: { 'Content-Type': 'text/html' } });
			}
		);
		expect(renders).toBe(3);
	});
});

describe('edition-aware SSR cache', () => {
	test('cache lookup and background storage failures preserve the rendered page', async () => {
		const pending: Promise<unknown>[] = [];
		const cache: HtmlCache = {
			match() {
				throw new Error('Cache unavailable');
			},
			put() {
				throw new Error('Cache unavailable');
			}
		};
		const response = await cachedHtml(
			new Request(origin + '/note'),
			publicContext,
			routing,
			cache,
			{
				waitUntil(promise) {
					pending.push(promise);
				}
			},
			async () => new Response('rendered', { headers: { 'Content-Type': 'text/html' } })
		);
		expect(await response.text()).toBe('rendered');
		await Promise.all(pending);
	});
	test('HTML hits are separated by app, edition, snapshot and path', async () => {
		const memory = memoryCache();
		let renders = 0;
		const render = async () =>
			new Response(String(++renders), { headers: { 'Content-Type': 'text/html' } });
		const request = new Request(origin + '/note');
		expect(
			await (
				await cachedHtml(request, publicContext, routing, memory.cache, context, render)
			).text()
		).toBe('1');
		expect(
			await (
				await cachedHtml(request, publicContext, routing, memory.cache, context, render)
			).text()
		).toBe('1');
		for (const changed of [
			{ ...publicContext, edition: 'full' as const },
			{ ...publicContext, snapshot: fullSnapshot },
			{ ...publicContext, applicationVersion: 'd'.repeat(64) }
		])
			await cachedHtml(request, changed, routing, memory.cache, context, render);
		await cachedHtml(
			new Request(origin + '/'),
			publicContext,
			routing,
			memory.cache,
			context,
			render
		);
		expect(renders).toBe(5);
		expect(memory.values.size).toBe(5);
		for (const response of memory.values.values())
			expect(response.headers.has('Set-Cookie')).toBe(false);
	});

	test('personal, stateful, data, error and variant responses are never stored', async () => {
		const memory = memoryCache();
		const expanded = {
			...routing,
			routes: [
				...routing.routes,
				'/admin/access',
				'/api/access',
				'/login',
				'/logout',
				'/%61dmin/access',
				'/note/__data.json'
			]
		};
		const render = async () => new Response('safe', { headers: { 'Content-Type': 'text/html' } });
		for (const pathname of [
			'/admin/access',
			'/api/access',
			'/login',
			'/logout',
			'/%61dmin/access',
			'/note/__data.json',
			'/note?query=1'
		])
			await cachedHtml(
				new Request(origin + pathname),
				publicContext,
				expanded,
				memory.cache,
				context,
				render
			);
		await cachedHtml(
			new Request(origin + '/note', { method: 'POST' }),
			publicContext,
			routing,
			memory.cache,
			context,
			render
		);
		await cachedHtml(
			new Request(origin + '/note', { headers: { range: 'bytes=0-1' } }),
			publicContext,
			routing,
			memory.cache,
			context,
			render
		);
		await cachedHtml(
			new Request(origin + '/note', { headers: { 'cache-control': 'no-cache' } }),
			publicContext,
			routing,
			memory.cache,
			context,
			render
		);
		for (const response of [
			new Response('error', { status: 500 }),
			new Response('personal', {
				headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'session=x' }
			}),
			new Response('variant', { headers: { 'Content-Type': 'text/html', Vary: 'Cookie' } }),
			Response.json({ private: true }),
			new Response('explicit no-store', {
				headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }
			})
		])
			await cachedHtml(
				new Request(origin + '/note'),
				publicContext,
				routing,
				memory.cache,
				context,
				async () => response
			);
		expect(memory.values.size).toBe(0);
	});
});
