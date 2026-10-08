import { describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import {
	copyFileSync,
	closeSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Execute the complete maintained action in an isolated repository. The SDK
 * and Bun transport process are fake: neither contacts GitHub nor reads real
 * build products or cache credentials.
 */
interface FixtureOptions {
	mode?: 'save' | 'restore';
	namespace?: string;
	ref?: string;
	event?: string;
	cacheHit?: boolean;
	allowFailure?: boolean;
	planNamespace?: string;
	planKey?: string;
	emptyPlan?: boolean;
	planArchive?: string;
}
function saveFixture(transfer: unknown, options: FixtureOptions = {}) {
	const root = mkdtempSync(path.join(tmpdir(), 'wisconsin-product-action-'));
	try {
		execFileSync('git', ['init', '--quiet', root], { stdio: 'pipe' });
		const action = path.join(root, '.github/actions/product-cache/index.mjs');
		const site = path.join(root, 'site');
		const products = path.join(site, 'build/generated/product-caches');
		const sdk = path.join(site, 'node_modules/@actions/cache');
		const binary = path.join(root, 'bin/bun');
		for (const directory of [
			path.dirname(action),
			products,
			path.join(sdk, 'lib'),
			path.dirname(binary)
		])
			mkdirSync(directory, { recursive: true });
		copyFileSync(
			fileURLToPath(new URL('../../../.github/actions/product-cache/index.mjs', import.meta.url)),
			action
		);
		writeFileSync(
			path.join(sdk, 'package.json'),
			JSON.stringify({ name: '@actions/cache', type: 'module' })
		);
		writeFileSync(
			path.join(sdk, 'lib/cache.js'),
			`
import {appendFileSync} from 'node:fs';
export const isFeatureAvailable=()=>true;
export async function saveCache(files,key) {
 appendFileSync(process.env.FIXTURE_SDK_CALLS,JSON.stringify({method:'saveCache',files,key})+'\\n');
 return 123;
}
export async function restoreCache(files,key,restoreKeys) {
 appendFileSync(process.env.FIXTURE_SDK_CALLS,JSON.stringify({method:'restoreCache',files,key,restoreKeys})+'\\n');
 return process.env.FIXTURE_CACHE_HIT==='true'?key:undefined;
}
`
		);
		const namespace = options.namespace ?? 'production';
		const prefix =
			namespace === 'benchmark' ? 'wisconsin-products-benchmark-v1-' : 'wisconsin-products-v1-';
		const group = {
			id: 'search-public',
			namespace: options.planNamespace ?? namespace,
			key: options.planKey ?? prefix + 'fixture-product-key',
			restoreKeys: [prefix + 'fixture-'],
			archive:
				options.planArchive ??
				`build/generated/product-caches/${namespace === 'benchmark' ? 'benchmark/' : ''}search-public.gpg`
		};
		const archive = path.join(site, group.archive);
		mkdirSync(path.dirname(archive), { recursive: true });
		writeFileSync(archive, 'stale archive from a previous save');
		// Deliberately leave a stale ready result too. The action must consume the
		// fresh per-group transfer result written by this invocation.
		writeFileSync(
			path.join(products, `${options.mode ?? 'save'}-${namespace}-search-public.json`),
			JSON.stringify({ schema: 1, namespace, results: [{ id: group.id, ready: true }] })
		);
		writeFileSync(
			path.join(site, 'fixture.json'),
			JSON.stringify({ group, transfer, namespace, emptyPlan: options.emptyPlan ?? false })
		);
		writeFileSync(
			binary,
			`#!/usr/bin/env node
import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
const args=process.argv.slice(2);
const fixture=JSON.parse(readFileSync('fixture.json','utf8'));
appendFileSync(process.env.FIXTURE_TRANSPORT_CALLS,JSON.stringify(args)+'\\n');
if(args[0]!=='tooling/cache.ts')throw new Error('Unexpected transport entry point');
const flag=args.indexOf('--plan-file');
if(flag<0||!args[flag+1])throw new Error('Transport result path is required');
if(args[args.indexOf('--namespace')+1]!==fixture.namespace)throw new Error('Namespace not forwarded');
if(args[1]==='plan') {
 const kind=args.indexOf('--kind');
 const groups=!fixture.emptyPlan&&(kind<0||args[kind+1]==='search')?[fixture.group]:[];
 writeFileSync(args[flag+1],JSON.stringify({schema:1,namespace:fixture.namespace,groups}));
} else if(args[1]==='save-products'||args[1]==='restore-products') {
 if(args[args.indexOf('--group')+1]!==fixture.group.id)throw new Error('Unexpected group');
 const result=fixture.transfer;
 if(result!=='leave-stale')writeFileSync(args[flag+1],typeof result==='string'?result:JSON.stringify({namespace:fixture.namespace,...result}));
} else throw new Error('Unexpected transport operation');
`,
			{ mode: 0o755 }
		);
		// Node treats extensionless executable files as CommonJS without this
		// package scope; the fake transport intentionally uses only ESM.
		writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }));
		const sdkCalls = path.join(root, 'sdk-calls.jsonl');
		const transportCalls = path.join(root, 'transport-calls.jsonl');
		const outputFile = path.join(root, 'outputs');
		const stdoutFile = path.join(root, 'stdout');
		const stderrFile = path.join(root, 'stderr');
		const stdoutDescriptor = openSync(stdoutFile, 'w');
		const stderrDescriptor = openSync(stderrFile, 'w');
		const child = spawnSync('node', [action], {
			cwd: root,
			encoding: 'utf8',
			timeout: 10000,
			stdio: ['ignore', stdoutDescriptor, stderrDescriptor],
			env: {
				PATH: `${path.dirname(binary)}${path.delimiter}${process.env.PATH ?? ''}`,
				INPUT_MODE: options.mode ?? 'save',
				INPUT_NAMESPACE: namespace,
				BUILD_CACHE_KEY: 'synthetic-fixture-key',
				GITHUB_REF: options.ref ?? 'refs/heads/main',
				GITHUB_EVENT_NAME: options.event ?? 'workflow_dispatch',
				GITHUB_OUTPUT: outputFile,
				FIXTURE_CACHE_HIT: String(options.cacheHit ?? true),
				FIXTURE_SDK_CALLS: sdkCalls,
				FIXTURE_TRANSPORT_CALLS: transportCalls
			}
		});
		closeSync(stdoutDescriptor);
		closeSync(stderrDescriptor);
		const stdout = readFileSync(stdoutFile, 'utf8');
		const stderr = readFileSync(stderrFile, 'utf8');
		if (child.error || (child.status !== 0 && !options.allowFailure))
			throw new Error(
				`Product action fixture failed: ${child.error?.message || stderr || child.signal}`
			);
		const calls = (file: string) =>
			existsSync(file)
				? readFileSync(file, 'utf8')
						.trim()
						.split('\n')
						.filter(Boolean)
						.map((line) => JSON.parse(line))
				: [];
		if (child.status === 0 && !stdout.includes('Encrypted product cache results: '))
			throw new Error('Missing cache summary from the isolated action fixture');
		return {
			status: child.status,
			stdout,
			stderr,
			outputs: existsSync(outputFile) ? readFileSync(outputFile, 'utf8') : '',
			counts: stdout
				.split('\n')
				.filter((line) => line.startsWith('Encrypted product cache results: '))
				.map((line) => JSON.parse(line.slice('Encrypted product cache results: '.length)))
				.at(-1),
			sdkCalls: calls(sdkCalls),
			transportCalls: calls(transportCalls),
			archiveRetained: readFileSync(archive, 'utf8') === 'stale archive from a previous save',
			group
		};
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

describe('product cache action save readiness', () => {
	test('a stale archive and stale ready result cannot publish a fresh ready=false transfer', () => {
		const result = saveFixture({ schema: 1, results: [{ id: 'search-public', ready: false }] });
		expect(result.archiveRetained).toBe(true);
		expect(result.sdkCalls).toEqual([]);
		expect(result.transportCalls).toHaveLength(2);
		const save = result.transportCalls[1] as string[];
		expect(save[1]).toBe('save-products');
		expect(save[save.indexOf('--plan-file') + 1]).toBe(
			'build/generated/product-caches/save-production-search-public.json'
		);
	});
	test('a fresh ready=true result for the matching group publishes its archive', () => {
		const result = saveFixture({ schema: 1, results: [{ id: 'search-public', ready: true }] });
		expect(result.sdkCalls).toHaveLength(1);
		expect(result.sdkCalls[0].method).toBe('saveCache');
		expect(result.sdkCalls[0].key).toBe(result.group.key);
		expect(result.sdkCalls[0].files).toHaveLength(1);
		expect(result.sdkCalls[0].files[0]).toEndWith(
			'/site/build/generated/product-caches/search-public.gpg'
		);
	});
	test.each([
		['malformed JSON', '{'],
		['wrong group', { schema: 1, results: [{ id: 'search-full', ready: true }] }],
		['wrong schema', { schema: 2, results: [{ id: 'search-public', ready: true }] }],
		['nonboolean readiness', { schema: 1, results: [{ id: 'search-public', ready: 'true' }] }],
		[
			'ambiguous result list',
			{
				schema: 1,
				results: [
					{ id: 'search-public', ready: true },
					{ id: 'search-full', ready: true }
				]
			}
		],
		['missing result list', { schema: 1 }]
	])('skips saving for %s', (_label, transfer) => {
		const result = saveFixture(transfer);
		expect(result.sdkCalls).toEqual([]);
		expect(result.archiveRetained).toBe(true);
	});
});

const readyTransfer = { schema: 1, results: [{ id: 'search-public', ready: true }] };

describe('product cache action trust boundaries', () => {
	test.each(['save', 'restore'] as const)(
		'manual benchmark branch can %s isolated products',
		(mode) => {
			const result = saveFixture(readyTransfer, {
				mode,
				namespace: 'benchmark',
				ref: 'refs/heads/perf/build-performance'
			});
			expect(result.status).toBe(0);
			expect(result.sdkCalls).toHaveLength(1);
			expect(result.sdkCalls[0].key).toStartWith('wisconsin-products-benchmark-v1-');
			expect(result.sdkCalls[0].files[0]).toEndWith('/product-caches/benchmark/search-public.gpg');
			for (const call of result.transportCalls as string[][])
				expect(call[call.indexOf('--namespace') + 1]).toBe('benchmark');
			expect(result.counts.namespace).toBe('benchmark');
			expect(result.counts[mode === 'save' ? 'published' : 'restored']).toBe(1);
		}
	);
	test.each([
		['refs/heads/main', 'workflow_dispatch'],
		['refs/heads/perf/build-performance', 'push'],
		['refs/heads/perf/build-performance', 'pull_request'],
		['refs/pull/48/merge', 'workflow_dispatch']
	])('benchmark namespace rejects %s on %s before SDK or transport use', (ref, event) => {
		for (const mode of ['restore', 'save'] as const) {
			const result = saveFixture(readyTransfer, {
				mode,
				namespace: 'benchmark',
				ref,
				event,
				allowFailure: true
			});
			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain('explicit trusted manual branch run');
			expect(result.sdkCalls).toEqual([]);
			expect(result.transportCalls).toEqual([]);
		}
	});
	test.each([
		['refs/heads/main', 'pull_request'],
		['refs/heads/perf/build-performance', 'workflow_dispatch'],
		['refs/pull/48/merge', 'pull_request']
	])('production publisher rejects %s on %s before SDK or transport use', (ref, event) => {
		const result = saveFixture(readyTransfer, { ref, event, allowFailure: true });
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('Only trusted main builds');
		expect(result.sdkCalls).toEqual([]);
		expect(result.transportCalls).toEqual([]);
	});
	test('main push remains a production publisher', () => {
		const result = saveFixture(readyTransfer, { event: 'push' });
		expect(result.counts.published).toBe(1);
		expect(result.sdkCalls[0].key).toStartWith('wisconsin-products-v1-');
	});
	test('pull requests can still restore production products', () => {
		const result = saveFixture(readyTransfer, {
			mode: 'restore',
			ref: 'refs/pull/48/merge',
			event: 'pull_request'
		});
		expect(result.counts.restored).toBe(1);
		expect(result.sdkCalls[0].method).toBe('restoreCache');
	});
	test.each([
		{ planNamespace: 'benchmark' },
		{ planKey: 'wisconsin-products-benchmark-v1-cross-namespace' },
		{ planArchive: 'build/generated/product-caches/benchmark/search-public.gpg' }
	])('rejects a production plan crossing the namespace: %j', (options) => {
		const result = saveFixture(readyTransfer, { ...options, allowFailure: true });
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('selected namespace');
		expect(result.sdkCalls).toEqual([]);
	});
});

describe('product cache action verified restore accounting', () => {
	test('an archive cache hit with ready=false still requires rebuilding', () => {
		const result = saveFixture(
			{ schema: 1, results: [{ id: 'search-public', ready: false }] },
			{ mode: 'restore' }
		);
		expect(result.counts).toMatchObject({
			requested: 1,
			hits: 1,
			misses: 0,
			restored: 0,
			rebuild_needed: 1,
			failed: 0
		});
		expect(result.outputs).toContain('restored=0\n');
		expect(result.outputs).toContain('rebuild_needed=1\n');
	});
	test('a cache miss performs no transfer and is visible in the summary', () => {
		const result = saveFixture(readyTransfer, { mode: 'restore', cacheHit: false });
		expect(result.counts).toMatchObject({
			requested: 1,
			hits: 0,
			misses: 1,
			restored: 0,
			rebuild_needed: 1
		});
		expect(result.transportCalls.every((call: string[]) => call[1] === 'plan')).toBe(true);
	});
	test('a verified ready=true result is counted as restored', () => {
		const result = saveFixture(readyTransfer, { mode: 'restore' });
		expect(result.counts).toMatchObject({
			requested: 1,
			hits: 1,
			misses: 0,
			restored: 1,
			rebuild_needed: 0,
			failed: 0
		});
		expect(result.outputs).toContain('restored=1\n');
	});
	test('a result from another namespace is not a verified restore', () => {
		const result = saveFixture({ ...readyTransfer, namespace: 'benchmark' }, { mode: 'restore' });
		expect(result.counts.restored).toBe(0);
		expect(result.counts.rebuild_needed).toBe(1);
	});
	test.each(['restore', 'save'] as const)(
		'stale ready results cannot satisfy a %s that writes no result',
		(mode) => {
			const result = saveFixture('leave-stale', { mode });
			expect(result.counts.restored).toBe(0);
			expect(result.counts.published).toBe(0);
			expect(result.counts.failed).toBe(1);
			expect(result.sdkCalls.filter((call) => call.method === 'saveCache')).toEqual([]);
		}
	);
	test('an empty save plan reports zero requested and published groups', () => {
		const result = saveFixture(readyTransfer, { emptyPlan: true });
		expect(result.counts).toMatchObject({ requested: 0, published: 0, skipped: 0, failed: 0 });
		expect(result.stdout).toContain('"groups":0');
		expect(result.sdkCalls).toEqual([]);
	});
});
