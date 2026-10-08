import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export interface DeploymentConfig {
	name: string;
	main: string;
	compatibility_date: string;
	compatibility_flags: string[];
	vars: Record<string, string>;
	d1_databases: {
		binding: string;
		database_name: string;
		database_id: string;
		migrations_dir?: string;
	}[];
	r2_buckets?: { binding: string; bucket_name: string; jurisdiction?: string }[];
	assets: {
		binding: string;
		directory: string;
		html_handling: 'drop-trailing-slash';
		not_found_handling: '404-page';
		run_worker_first: true;
	};
	workers_dev: false;
	preview_urls: false;
	routes: { pattern: string; custom_domain: true }[];
	account_id?: string;
	minify?: boolean;
	upload_source_maps?: boolean;
}

export function deploymentError(message: string): never {
	// Messages deliberately exclude API bodies, credentials, private paths, and module contents.
	throw new Error(`deployment: ${message}`);
}

export function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function allowedKeys(value: Record<string, unknown>, allowed: string[]): void {
	if (Object.keys(value).some((key) => !allowed.includes(key)))
		deploymentError('unsupported configuration');
}

export function sha256(bytes: Uint8Array | string): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (record(value))
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, canonical(value[key])])
		);
	return value;
}

export function configSha256(config: DeploymentConfig): string {
	return sha256(JSON.stringify(canonical(config)));
}

export function validateDeploymentConfig(value: unknown): DeploymentConfig {
	if (!record(value)) deploymentError('invalid configuration');
	allowedKeys(value, [
		'$schema',
		'name',
		'main',
		'compatibility_date',
		'compatibility_flags',
		'vars',
		'd1_databases',
		'r2_buckets',
		'assets',
		'workers_dev',
		'preview_urls',
		'routes',
		'account_id',
		'minify',
		'upload_source_maps'
	]);
	if (
		typeof value.name !== 'string' ||
		!/^[a-z0-9][a-z0-9_-]*$/.test(value.name) ||
		typeof value.main !== 'string' ||
		!value.main
	)
		deploymentError('invalid Worker identity');
	if (
		typeof value.compatibility_date !== 'string' ||
		!/^\d{4}-\d{2}-\d{2}$/.test(value.compatibility_date) ||
		!Array.isArray(value.compatibility_flags) ||
		value.compatibility_flags.some((flag) => typeof flag !== 'string')
	)
		deploymentError('invalid compatibility settings');
	if (
		!record(value.vars) ||
		Object.entries(value.vars).some(([key, v]) => !bindingName(key) || typeof v !== 'string')
	)
		deploymentError('unsupported variables');
	if (!Array.isArray(value.d1_databases)) deploymentError('missing D1 configuration');
	for (const database of value.d1_databases) {
		if (!record(database)) deploymentError('invalid D1 configuration');
		allowedKeys(database, ['binding', 'database_name', 'database_id', 'migrations_dir']);
		if (
			!bindingName(database.binding) ||
			typeof database.database_name !== 'string' ||
			typeof database.database_id !== 'string' ||
			!/^[0-9a-f-]{36}$/.test(database.database_id) ||
			(database.migrations_dir !== undefined && typeof database.migrations_dir !== 'string')
		)
			deploymentError('invalid D1 configuration');
	}
	if (value.r2_buckets !== undefined) {
		if (!Array.isArray(value.r2_buckets)) deploymentError('invalid R2 configuration');
		for (const bucket of value.r2_buckets) {
			if (!record(bucket)) deploymentError('invalid R2 configuration');
			allowedKeys(bucket, ['binding', 'bucket_name', 'jurisdiction']);
			if (
				!bindingName(bucket.binding) ||
				typeof bucket.bucket_name !== 'string' ||
				!bucket.bucket_name ||
				(bucket.jurisdiction !== undefined && typeof bucket.jurisdiction !== 'string')
			)
				deploymentError('invalid R2 configuration');
		}
	}
	if (!record(value.assets)) deploymentError('missing asset configuration');
	allowedKeys(value.assets, [
		'binding',
		'directory',
		'html_handling',
		'not_found_handling',
		'run_worker_first'
	]);
	if (
		!bindingName(value.assets.binding) ||
		typeof value.assets.directory !== 'string' ||
		!value.assets.directory ||
		value.assets.run_worker_first !== true ||
		value.assets.html_handling !== 'drop-trailing-slash' ||
		value.assets.not_found_handling !== '404-page'
	)
		deploymentError('unsupported asset routing');
	if (value.workers_dev !== false || value.preview_urls !== false)
		deploymentError('public development endpoints must be disabled');
	if (!Array.isArray(value.routes) || !value.routes.length)
		deploymentError('missing custom domains');
	for (const route of value.routes) {
		if (!record(route)) deploymentError('invalid custom domain');
		allowedKeys(route, ['pattern', 'custom_domain']);
		if (
			route.custom_domain !== true ||
			typeof route.pattern !== 'string' ||
			!/^[a-z0-9.-]+$/.test(route.pattern) ||
			!route.pattern.includes('.')
		)
			deploymentError('unsupported custom domain');
	}
	if (
		new Set(value.routes.map((route) => (route as { pattern: string }).pattern)).size !==
		value.routes.length
	)
		deploymentError('duplicate custom domains');
	if (
		value.account_id !== undefined &&
		(typeof value.account_id !== 'string' || !/^[0-9a-f]{32}$/.test(value.account_id))
	)
		deploymentError('invalid account identity');
	for (const key of ['minify', 'upload_source_maps'])
		if (value[key] !== undefined && typeof value[key] !== 'boolean')
			deploymentError('invalid build settings');
	const config = { ...value };
	delete config.$schema;
	const names = [
		...Object.keys(value.vars),
		...value.d1_databases.map((db) => (db as { binding: string }).binding),
		...((value.r2_buckets ?? []) as { binding: string }[]).map((bucket) => bucket.binding),
		value.assets.binding
	];
	if (new Set(names).size !== names.length) deploymentError('duplicate bindings');
	return config as unknown as DeploymentConfig;
}

export function bindingName(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

export function readDeploymentConfig(siteRoot: string): DeploymentConfig {
	const parsed = ts.parseConfigFileTextToJson(
		'wrangler.jsonc',
		readFileSync(path.join(siteRoot, 'wrangler.jsonc'), 'utf8')
	);
	if (parsed.error) deploymentError('invalid JSONC configuration');
	return validateDeploymentConfig(parsed.config);
}

export function expectedBindings(config: DeploymentConfig): Record<string, unknown>[] {
	return [
		...Object.entries(config.vars).map(([name, text]) => ({ name, type: 'plain_text', text })),
		...config.d1_databases.map(({ binding: name, database_id: id }) => ({ name, type: 'd1', id })),
		...(config.r2_buckets ?? []).map(({ binding: name, bucket_name, jurisdiction }) => ({
			name,
			type: 'r2_bucket',
			bucket_name,
			...(jurisdiction === undefined ? {} : { jurisdiction })
		})),
		{ name: config.assets.binding, type: 'assets' }
	];
}

export function equalJSON(a: unknown, b: unknown): boolean {
	return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
