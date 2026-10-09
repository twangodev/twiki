import {
	configSha256,
	deploymentError,
	equalJSON,
	record,
	type DeploymentConfig
} from './deployment-config';
import {
	ASSET_HASH,
	validateAssetInventory,
	verifyAssetBytes,
	type DeploymentAsset
} from './deployment-manifest';
import {
	validatePreparedWorker,
	verifyModuleBytes,
	type DeploymentSnapshot,
	type PreparedModule
} from './deployment-prepare';

export interface DeploymentAPI {
	request(endpoint: string, init?: RequestInit, bearer?: string): Promise<unknown>;
}

/** Official API, bounded retry, sanitized errors. Caller must explicitly invoke --upload. */
export class CloudflareDeploymentAPI implements DeploymentAPI {
	constructor(
		private readonly token: string,
		private readonly fetcher: (input: string, init: RequestInit) => Promise<Response> = fetch,
		private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
			new Promise((resolve) => setTimeout(resolve, milliseconds))
	) {
		if (!token || /[\r\n]/.test(token)) deploymentError('missing API credential');
	}

	async request(endpoint: string, init: RequestInit = {}, bearer = this.token): Promise<unknown> {
		if (!endpoint.startsWith('/accounts/') || endpoint.includes('://') || /[\r\n]/.test(endpoint))
			deploymentError('invalid API endpoint');
		for (let attempt = 0; attempt < 4; attempt++) {
			let response: Response;
			try {
				response = await this.fetcher(`https://api.cloudflare.com/client/v4${endpoint}`, {
					...init,
					redirect: 'error',
					signal: AbortSignal.timeout(30_000),
					headers: {
						...Object.fromEntries(new Headers(init.headers)),
						Authorization: `Bearer ${bearer}`
					}
				});
			} catch {
				if (attempt === 3) deploymentError('API transport failed');
				await this.sleep(Math.min(1000 * 2 ** attempt, 10_000));
				continue;
			}
			if (response.status === 429 || response.status >= 500) {
				if (attempt === 3) deploymentError(`API transient failure (${response.status})`);
				const retryAfter = response.headers.get('Retry-After');
				const seconds = retryAfter === null ? NaN : Number(retryAfter);
				const delay = Number.isFinite(seconds)
					? seconds * 1000
					: retryAfter
						? Date.parse(retryAfter) - Date.now()
						: NaN;
				await response.body?.cancel();
				await this.sleep(
					Math.max(0, Math.min(Number.isFinite(delay) ? delay : 1000 * 2 ** attempt, 30_000))
				);
				continue;
			}
			if (!response.ok) deploymentError(`API request failed (${response.status})`);
			let envelope: unknown;
			try {
				envelope = await response.json();
			} catch {
				deploymentError('invalid API response');
			}
			if (!record(envelope) || envelope.success !== true || !('result' in envelope))
				deploymentError('API operation failed');
			// Domain listings must be complete; fail instead of silently accepting a truncated collection.
			if (
				/\/workers\/domains(?:\?|$)/.test(endpoint) &&
				record(envelope.result_info) &&
				typeof envelope.result_info.total_pages === 'number' &&
				envelope.result_info.total_pages > 1
			)
				deploymentError('paginated domain listing unsupported');
			return envelope.result;
		}
		deploymentError('API retries exhausted');
	}
}

export interface DeploymentBodyProvider {
	readModule(module: PreparedModule): Promise<Uint8Array>;
	readAsset(filename: string, asset: DeploymentAsset): Promise<Uint8Array>;
}

function jsonRequest(method: string, body: unknown): RequestInit {
	return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

async function verifyRouting(
	api: DeploymentAPI,
	accountPrefix: string,
	workerPrefix: string,
	config: DeploymentConfig
): Promise<void> {
	const [domains, subdomain] = await Promise.all([
		api.request(
			`${accountPrefix}/workers/domains?service=${encodeURIComponent(config.name)}&environment=production`
		),
		api.request(`${workerPrefix}/subdomain`)
	]);
	if (
		!Array.isArray(domains) ||
		domains.some(
			(domain) =>
				!record(domain) ||
				typeof domain.hostname !== 'string' ||
				domain.service !== config.name ||
				domain.environment !== 'production'
		)
	)
		deploymentError('invalid custom domain response');
	if (
		!equalJSON(
			domains.map((domain) => domain.hostname).sort(),
			config.routes.map((route) => route.pattern).sort()
		)
	)
		deploymentError('custom domains differ; explicit route provisioning is required');
	if (!record(subdomain) || subdomain.enabled !== false || subdomain.previews_enabled !== false)
		deploymentError('remote development endpoints must already be disabled');
}

export interface UploadDeploymentOptions extends DeploymentBodyProvider {
	api: DeploymentAPI;
	accountId: string;
	expectedProvenance: string;
	config: DeploymentConfig;
	log?: (message: string) => void;
}

/** Upload requested bodies only. An authenticated cached inventory can supply the complete manifest. */
export async function uploadDeployment(
	snapshot: DeploymentSnapshot,
	options: UploadDeploymentOptions
): Promise<{ uploadedAssets: number; versionId?: string }> {
	const { api, config } = options;
	if (
		!/^[0-9a-f]{32}$/.test(options.accountId) ||
		(config.account_id && config.account_id !== options.accountId)
	)
		deploymentError('account identity mismatch');
	if (
		snapshot.schema !== 1 ||
		snapshot.provenance !== options.expectedProvenance ||
		snapshot.configSha256 !== configSha256(config)
	)
		deploymentError('stale deployment snapshot');
	const inventory = validateAssetInventory(snapshot.inventory, options.expectedProvenance);
	const worker = validatePreparedWorker(snapshot.worker, config);
	const modules: [PreparedModule, Uint8Array][] = [];
	// Validate every Worker dependency before performing any remote mutation.
	for (const module of worker.modules) {
		let bytes: Uint8Array;
		try {
			bytes = await options.readModule(module);
		} catch {
			deploymentError('prepared Worker module is unavailable');
		}
		verifyModuleBytes(module, bytes);
		modules.push([module, bytes]);
	}
	const accountPrefix = `/accounts/${options.accountId}`;
	const workerPrefix = `${accountPrefix}/workers/scripts/${encodeURIComponent(config.name)}`;
	await verifyRouting(api, accountPrefix, workerPrefix, config);
	const manifest = Object.fromEntries(
		Object.entries(inventory.assets).map(([filename, { hash, size }]) => [filename, { hash, size }])
	);
	const byHash = new Map<string, [string, DeploymentAsset]>();
	for (const [filename, asset] of Object.entries(inventory.assets)) {
		const existing = byHash.get(asset.hash);
		if (
			existing &&
			(existing[1].sha256 !== asset.sha256 ||
				existing[1].size !== asset.size ||
				existing[1].contentType !== asset.contentType)
		)
			deploymentError('ambiguous asset hash');
		byHash.set(asset.hash, [filename, asset]);
	}
	const session = await api.request(
		`${workerPrefix}/assets-upload-session`,
		jsonRequest('POST', { manifest })
	);
	if (
		!record(session) ||
		typeof session.jwt !== 'string' ||
		!session.jwt ||
		!Array.isArray(session.buckets)
	)
		deploymentError('invalid asset upload session');
	const buckets: string[][] = [];
	const seen = new Set<string>();
	for (const bucket of session.buckets) {
		if (!Array.isArray(bucket) || !bucket.length) deploymentError('invalid requested asset bucket');
		for (const hash of bucket) {
			if (typeof hash !== 'string' || !ASSET_HASH.test(hash) || !byHash.has(hash) || seen.has(hash))
				deploymentError('invalid requested asset hash');
			seen.add(hash);
		}
		buckets.push(bucket);
	}
	const uploadToken = session.jwt;
	let completionToken = buckets.length === 0 ? uploadToken : '';
	let cursor = 0;
	let failed = false;
	async function uploadBuckets(): Promise<void> {
		while (!failed && cursor < buckets.length) {
			const bucket = buckets[cursor++];
			try {
				const payload = new FormData();
				for (const hash of bucket) {
					const [filename, asset] = byHash.get(hash)!;
					let bytes: Uint8Array;
					try {
						bytes = await options.readAsset(filename, asset);
					} catch {
						deploymentError('requested asset body is unavailable');
					}
					verifyAssetBytes(filename, asset, bytes);
					payload.append(
						hash,
						new File([Buffer.from(bytes).toString('base64')], hash, { type: asset.contentType }),
						hash
					);
				}
				const result = await api.request(
					`${accountPrefix}/workers/assets/upload?base64=true`,
					{ method: 'POST', body: payload },
					uploadToken
				);
				if (
					!record(result) ||
					(result.jwt !== undefined && (typeof result.jwt !== 'string' || !result.jwt))
				)
					deploymentError('invalid asset completion response');
				if (typeof result.jwt === 'string') {
					if (completionToken && completionToken !== result.jwt)
						deploymentError('conflicting asset completion tokens');
					completionToken = result.jwt;
				}
			} catch (error) {
				failed = true;
				throw error;
			}
		}
	}
	const results = await Promise.allSettled(
		Array.from({ length: Math.min(3, buckets.length) }, uploadBuckets)
	);
	for (const result of results) if (result.status === 'rejected') throw result.reason;
	if (!completionToken) deploymentError('asset upload did not complete');
	const metadata = {
		...worker.metadata,
		keep_bindings: ['secret_text', 'secret_key'],
		assets: {
			jwt: completionToken,
			config: {
				html_handling: config.assets.html_handling,
				not_found_handling: config.assets.not_found_handling,
				run_worker_first: true,
				...inventory.controlFiles
			}
		}
	};
	const payload = new FormData();
	payload.set('metadata', JSON.stringify(metadata));
	for (const [module, bytes] of modules)
		payload.set(module.name, new File([bytes as BlobPart], module.name, { type: module.type }));
	const deployment = await api.request(`${workerPrefix}?bindings_inherit=strict`, {
		method: 'PUT',
		body: payload
	});
	if (!record(deployment)) deploymentError('invalid Worker deployment result');
	// Verify endpoint/domain state again; never create, remove, or retarget domains silently.
	await verifyRouting(api, accountPrefix, workerPrefix, config);
	const versionId = typeof deployment.version_id === 'string' ? deployment.version_id : undefined;
	options.log?.(`deployment: uploaded ${seen.size} asset bodies; Worker API accepted deployment`);
	return { uploadedAssets: seen.size, ...(versionId ? { versionId } : {}) };
}
