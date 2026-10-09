import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
	configSha256,
	expectedBindings,
	sha256,
	validateDeploymentConfig,
	type DeploymentConfig
} from '../../tooling/lib/deployment-config';
import {
	captureAssetInventory,
	createAssetInventory,
	deploymentAsset,
	inventoryDigest,
	mergeVerifiedInventories,
	wranglerAssetHash
} from '../../tooling/lib/deployment-manifest';
import {
	buildDeploymentSnapshot,
	capturePreparedWorker,
	loadPreparedWorker,
	workerDigest,
	type PreparedWorker
} from '../../tooling/lib/deployment-prepare';
import {
	CloudflareDeploymentAPI,
	uploadDeployment,
	type DeploymentAPI
} from '../../tooling/lib/deployment-upload';

const provenance = sha256('current complete products');
const accountId = 'a'.repeat(32);
const config: DeploymentConfig = {
	name: 'wisconsin',
	main: 'build/worker.js',
	compatibility_date: '2026-06-07',
	compatibility_flags: ['nodejs_compat'],
	vars: { ORIGIN: 'https://wisconsin.example.com' },
	d1_databases: [
		{
			binding: 'DB',
			database_name: 'wisconsin',
			database_id: 'adbf2cf8-5c57-497b-bfae-8ffd82042d41'
		}
	],
	assets: {
		binding: 'ASSETS',
		directory: 'build/assets',
		html_handling: 'drop-trailing-slash',
		not_found_handling: '404-page',
		run_worker_first: true
	},
	workers_dev: false,
	preview_urls: false,
	routes: [{ pattern: 'wisconsin.example.com', custom_domain: true }]
};

function prepared(): { worker: PreparedWorker; body: Uint8Array } {
	const body = Buffer.from('export default {fetch(){return new Response("ok")}}');
	const worker: PreparedWorker = {
		schema: 1,
		configSha256: configSha256(config),
		wranglerVersion: '4.100.0',
		metadata: {
			main_module: 'worker.js',
			compatibility_date: config.compatibility_date,
			compatibility_flags: config.compatibility_flags,
			bindings: expectedBindings(config),
			keep_bindings: ['secret_text', 'secret_key']
		},
		modules: [
			{
				name: 'worker.js',
				type: 'application/javascript+module',
				sha256: sha256(body),
				size: body.length,
				filename: `modules/${sha256(body)}`
			}
		],
		digest: ''
	};
	worker.digest = workerDigest(worker);
	return { worker, body };
}

function fixture() {
	const { worker, body } = prepared();
	const bodies = {
		'/public.html': Buffer.from('public content'),
		'/private.html': Buffer.from('private content')
	};
	const inventory = createAssetInventory(
		Object.fromEntries(
			Object.entries(bodies).map(([name, bytes]) => [name, deploymentAsset(bytes, name)])
		),
		provenance,
		{ _headers: '/*\n  X-Frame-Options: DENY', _redirects: '/old /new 301' }
	);
	return { snapshot: buildDeploymentSnapshot(worker, inventory, config, provenance), bodies, body };
}

function fakeAPI(session: unknown, upload: unknown = { jwt: 'completion-secret' }) {
	const calls: { endpoint: string; init?: RequestInit; bearer?: string }[] = [];
	const api: DeploymentAPI = {
		async request(endpoint, init, bearer) {
			calls.push({ endpoint, init, bearer });
			if (endpoint.includes('/domains?'))
				return [
					{ hostname: config.routes[0].pattern, service: config.name, environment: 'production' }
				];
			if (endpoint.endsWith('/subdomain')) return { enabled: false, previews_enabled: false };
			if (endpoint.endsWith('/assets-upload-session')) return session;
			if (endpoint.includes('/assets/upload?')) return upload;
			return { version_id: 'version-1' };
		}
	};
	return { api, calls };
}

test('asset hash matches Wrangler byte/extension algorithm and ignores timestamp metadata', async () => {
	expect(wranglerAssetHash(Buffer.from('hello'), '/x.txt')).toBe(
		'f0b3413d4cabb000327fad369003d6a5'
	);
	expect(wranglerAssetHash(Buffer.from('hello'), '/renamed.txt')).toBe(
		wranglerAssetHash(Buffer.from('hello'), '/x.txt')
	);
	expect(wranglerAssetHash(Buffer.from('hello'), '/x.html')).not.toBe(
		wranglerAssetHash(Buffer.from('hello'), '/x.txt')
	);
	const directory = await mkdtemp(path.join(os.tmpdir(), 'deployment-assets-'));
	try {
		await mkdir(path.join(directory, 'private'));
		await writeFile(path.join(directory, 'public.txt'), 'hello');
		await writeFile(path.join(directory, 'private/ignored.txt'), 'private');
		await writeFile(path.join(directory, '.assetsignore'), 'private/\n');
		await writeFile(path.join(directory, '_headers'), '/*\n  X-Test: yes');
		const first = await captureAssetInventory(directory, provenance);
		expect(Object.keys(first.assets)).toEqual(['/public.txt']);
		expect(first.controlFiles._headers).toContain('X-Test: yes');
		await writeFile(path.join(directory, 'public.txt'), 'world'); // Same size, changed content.
		const second = await captureAssetInventory(directory, provenance);
		expect(second.assets['/public.txt'].hash).not.toBe(first.assets['/public.txt'].hash);
		await symlink('public.txt', path.join(directory, 'unsafe.txt'));
		await expect(captureAssetInventory(directory, provenance)).rejects.toThrow('symlinks');
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('verified merge drops revoked output and rejects stale, missing, or wrong-owner products without reading bodies', () => {
	const { snapshot } = fixture();
	const inventory = snapshot.inventory;
	const input = {
		pieces: [{ owner: 'course', inventory }],
		expectedProducts: { course: { provenance, digest: inventory.digest } },
		ownership: {
			'/public.html': {
				owner: 'course',
				sha256: inventory.assets['/public.html'].sha256,
				size: inventory.assets['/public.html'].size
			}
		},
		provenance,
		controlFiles: inventory.controlFiles
	};
	expect(Object.keys(mergeVerifiedInventories(input).assets)).toEqual(['/public.html']);
	expect(() => mergeVerifiedInventories({ ...input, pieces: [] })).toThrow('missing');
	expect(() =>
		mergeVerifiedInventories({
			...input,
			expectedProducts: { course: { provenance: sha256('old'), digest: inventory.digest } }
		})
	).toThrow('stale');
	expect(() =>
		mergeVerifiedInventories({
			...input,
			ownership: { '/public.html': { ...input.ownership['/public.html'], sha256: sha256('other') } }
		})
	).toThrow('cover');
	expect(() =>
		mergeVerifiedInventories({
			...input,
			ownership: { '/missing.html': input.ownership['/public.html'] }
		})
	).toThrow('cover');
});

test('exact Wrangler multipart capture retains imported modules and verifies every restored dependency', async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'deployment-worker-'));
	try {
		const { worker, body } = prepared();
		const form = new FormData();
		form.set('metadata', JSON.stringify({ ...worker.metadata, keep_bindings: undefined }));
		form.set(
			'worker.js',
			new File([new Uint8Array(body)], 'worker.js', { type: 'application/javascript+module' })
		);
		form.set(
			'nested/data.bin',
			new File([Buffer.from('dependency')], 'data.bin', { type: 'application/octet-stream' })
		);
		const captured = await capturePreparedWorker(
			new Uint8Array(await new Response(form).arrayBuffer()),
			config,
			'4.100.0',
			directory
		);
		expect(captured.modules.map((module) => module.name)).toEqual(['worker.js', 'nested/data.bin']);
		expect(captured.metadata.keep_bindings).toEqual(['secret_text', 'secret_key']);
		expect((await loadPreparedWorker(directory, config)).digest).toBe(captured.digest);
		await rm(path.join(directory, captured.modules[1].filename));
		await expect(loadPreparedWorker(directory, config)).rejects.toThrow();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('manifest deployment retrieves only requested bodies, preserves secrets/bindings/headers/privacy, and verifies domains', async () => {
	const { snapshot, bodies, body } = fixture();
	const requested = snapshot.inventory.assets['/private.html'].hash;
	const { api, calls } = fakeAPI({ jwt: 'upload-secret', buckets: [[requested]] });
	const reads: string[] = [];
	const logs: string[] = [];
	const result = await uploadDeployment(snapshot, {
		api,
		accountId,
		config,
		expectedProvenance: provenance,
		readModule: async () => body,
		readAsset: async (filename) => {
			reads.push(filename);
			return bodies[filename as keyof typeof bodies];
		},
		log: (message) => logs.push(message)
	});
	expect(result).toEqual({ uploadedAssets: 1, versionId: 'version-1' });
	expect(reads).toEqual(['/private.html']);
	const registration = calls.find((call) => call.endpoint.endsWith('/assets-upload-session'))!;
	expect(Object.keys(JSON.parse(registration.init!.body as string).manifest)).toEqual([
		'/public.html',
		'/private.html'
	]);
	const upload = calls.find((call) => call.endpoint.includes('/assets/upload?'))!;
	expect(upload.bearer).toBe('upload-secret');
	expect(await ((upload.init!.body as FormData).get(requested) as File).text()).toBe(
		bodies['/private.html'].toString('base64')
	);
	const deployment = calls.find((call) => call.init?.method === 'PUT')!;
	const metadata = JSON.parse((deployment.init!.body as FormData).get('metadata') as string);
	expect(metadata.bindings).toEqual(expectedBindings(config));
	expect(metadata.keep_bindings).toEqual(['secret_text', 'secret_key']);
	expect(metadata.assets).toEqual({
		jwt: 'completion-secret',
		config: {
			html_handling: 'drop-trailing-slash',
			not_found_handling: '404-page',
			run_worker_first: true,
			...snapshot.inventory.controlFiles
		}
	});
	expect(calls.filter((call) => call.endpoint.includes('/domains?'))).toHaveLength(2);
	expect(calls.some((call) => call.endpoint.includes('/domains') && call.init?.method)).toBe(false);
	expect(logs.join(' ')).not.toMatch(/private|secret|public\.html|contents/);
});

test('unchanged manifest skips all body access and uses returned completion token', async () => {
	const { snapshot, body } = fixture();
	const { api, calls } = fakeAPI({ jwt: 'completed', buckets: [] });
	await uploadDeployment(snapshot, {
		api,
		accountId,
		config,
		expectedProvenance: provenance,
		readModule: async () => body,
		readAsset: async () => {
			throw new Error('must not read');
		}
	});
	expect(calls.some((call) => call.endpoint.includes('/assets/upload?'))).toBe(false);
});

test('invalid requested hashes, absent completion, and corrupt bytes never publish Worker', async () => {
	const { snapshot, body } = fixture();
	const hash = snapshot.inventory.assets['/private.html'].hash;
	for (const session of [
		{ jwt: 'token', buckets: [['x'.repeat(32)]] },
		{ jwt: 'token', buckets: [['b'.repeat(32)]] },
		{ jwt: 'token', buckets: [[hash, hash]] },
		{ jwt: 'token', buckets: [[hash]] }
	]) {
		const { api, calls } = fakeAPI(session, {});
		await expect(
			uploadDeployment(snapshot, {
				api,
				accountId,
				config,
				expectedProvenance: provenance,
				readModule: async () => body,
				readAsset: async () => Buffer.from('wrong')
			})
		).rejects.toThrow('deployment:');
		expect(calls.some((call) => call.init?.method === 'PUT')).toBe(false);
	}
});

test('stale/incomplete inventories, missing modules, and route changes fail before mutations', async () => {
	const { snapshot, body } = fixture();
	for (const change of ['stale', 'incomplete', 'digest', 'module', 'route', 'endpoint']) {
		const input = structuredClone(snapshot);
		if (change === 'stale') input.provenance = sha256('other');
		if (change === 'incomplete')
			(input.inventory as unknown as { complete: boolean }).complete = false;
		if (change === 'digest') {
			delete input.inventory.assets['/private.html'];
		}
		const { api, calls } = fakeAPI({ jwt: 'complete', buckets: [] });
		const wrapped: DeploymentAPI = {
			async request(endpoint, init, bearer) {
				if (change === 'route' && endpoint.includes('/domains?'))
					return [
						{ hostname: 'wrong.example.com', service: config.name, environment: 'production' }
					];
				if (change === 'endpoint' && endpoint.endsWith('/subdomain'))
					return { enabled: true, previews_enabled: true };
				return api.request(endpoint, init, bearer);
			}
		};
		await expect(
			uploadDeployment(input, {
				api: wrapped,
				accountId,
				config,
				expectedProvenance: provenance,
				readModule: async () => {
					if (change === 'module') throw new Error('missing dependency');
					return body;
				},
				readAsset: async () => Buffer.alloc(0)
			})
		).rejects.toThrow('deployment:');
		expect(calls.some((call) => call.init?.method)).toBe(false);
	}
	expect(() => validateDeploymentConfig({ ...config, unsafe: { metadata: {} } })).toThrow(
		'unsupported'
	);
	expect(() =>
		validateDeploymentConfig({ ...config, assets: { ...config.assets, run_worker_first: false } })
	).toThrow('routing');
});

test('API retries transient failures using bounded Retry-After and hides error bodies/credentials', async () => {
	const waits: number[] = [];
	let attempts = 0;
	const client = new CloudflareDeploymentAPI(
		'top-secret',
		async (_url, init) => {
			expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer top-secret');
			expect(init!.redirect).toBe('error');
			attempts++;
			return attempts === 1
				? new Response('sensitive body', { status: 429, headers: { 'Retry-After': '2' } })
				: Response.json({ success: true, result: { ok: true } });
		},
		async (delay) => {
			waits.push(delay);
		}
	);
	expect(await client.request(`/accounts/${accountId}/workers/scripts/wisconsin`)).toEqual({
		ok: true
	});
	expect(waits).toEqual([2000]);
	const failing = new CloudflareDeploymentAPI(
		'top-secret',
		async () => new Response('top-secret private path', { status: 403 })
	);
	await expect(failing.request(`/accounts/${accountId}/workers/scripts/wisconsin`)).rejects.toThrow(
		'deployment: API request failed (403)'
	);
	const paginated = new CloudflareDeploymentAPI('top-secret', async () =>
		Response.json({ success: true, result: [], result_info: { total_pages: 2 } })
	);
	await expect(paginated.request(`/accounts/${accountId}/workers/domains`)).rejects.toThrow(
		'paginated'
	);
});

test('uploads use at most three concurrent buckets and require a completion token after all successful bodies', async () => {
	const { worker, body } = prepared();
	const bodies = Object.fromEntries(
		Array.from({ length: 8 }, (_, index) => [`/asset-${index}.txt`, Buffer.from(`body-${index}`)])
	);
	const inventory = createAssetInventory(
		Object.fromEntries(
			Object.entries(bodies).map(([name, bytes]) => [name, deploymentAsset(bytes, name)])
		),
		provenance
	);
	const snapshot = buildDeploymentSnapshot(worker, inventory, config, provenance);
	let active = 0;
	let maximum = 0;
	let completed = 0;
	const base = fakeAPI({
		jwt: 'upload-token',
		buckets: Object.values(inventory.assets).map(({ hash }) => [hash])
	});
	const api: DeploymentAPI = {
		async request(endpoint, init, bearer) {
			if (!endpoint.includes('/assets/upload?')) return base.api.request(endpoint, init, bearer);
			active++;
			maximum = Math.max(maximum, active);
			await new Promise((resolve) => setTimeout(resolve, 1));
			active--;
			completed++;
			return completed === 8 ? { jwt: 'completion-token' } : {};
		}
	};
	await uploadDeployment(snapshot, {
		api,
		accountId,
		config,
		expectedProvenance: provenance,
		readModule: async () => body,
		readAsset: async (name) => bodies[name]
	});
	expect(maximum).toBe(3);
	expect(completed).toBe(8);
	const missing = fakeAPI(
		{ jwt: 'upload-token', buckets: [[inventory.assets['/asset-0.txt'].hash]] },
		{}
	);
	await expect(
		uploadDeployment(snapshot, {
			api: missing.api,
			accountId,
			config,
			expectedProvenance: provenance,
			readModule: async () => body,
			readAsset: async (name) => bodies[name]
		})
	).rejects.toThrow('did not complete');
	expect(missing.calls.some((call) => call.init?.method === 'PUT')).toBe(false);
});

test('multipart package rejects duplicate module fields and corrupted framing', async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'deployment-malformed-'));
	try {
		const { worker, body } = prepared();
		const form = new FormData();
		form.set('metadata', JSON.stringify(worker.metadata));
		form.append(
			'worker.js',
			new File([new Uint8Array(body)], 'worker.js', { type: 'application/javascript+module' })
		);
		form.append(
			'worker.js',
			new File([new Uint8Array(body)], 'worker.js', { type: 'application/javascript+module' })
		);
		const bytes = new Uint8Array(await new Response(form).arrayBuffer());
		await expect(capturePreparedWorker(bytes, config, '4.100.0', directory)).rejects.toThrow(
			'module'
		);
		await expect(
			capturePreparedWorker(bytes.subarray(0, bytes.length - 10), config, '4.100.0', directory)
		).rejects.toThrow('multipart');
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('deployment history permits additional pages while domain ownership requires a complete listing', async () => {
	const client = new CloudflareDeploymentAPI('test-token', async () =>
		Response.json({
			success: true,
			result: { deployments: [{ versions: [{ version_id: 'existing', percentage: 100 }] }] },
			result_info: { total_pages: 2 }
		})
	);
	const result = await client.request(
		`/accounts/${accountId}/workers/scripts/wisconsin/deployments`
	);
	expect(result).toEqual({
		deployments: [{ versions: [{ version_id: 'existing', percentage: 100 }] }]
	});
	await expect(
		client.request(`/accounts/${accountId}/workers/domains?service=wisconsin`)
	).rejects.toThrow('paginated');
});
