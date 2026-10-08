import { describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
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
function saveFixture(transfer: unknown) {
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
export async function restoreCache() { throw new Error('Unexpected restore during save fixture'); }
`
		);
		const group = {
			id: 'search-public',
			key: 'fixture-product-key',
			archive: 'build/generated/product-caches/search-public.gpg'
		};
		const archive = path.join(site, group.archive);
		writeFileSync(archive, 'stale archive from a previous save');
		// Deliberately leave a stale ready result too. The action must consume the
		// fresh per-group transfer result written by this invocation.
		writeFileSync(
			path.join(products, 'save-search-public.json'),
			JSON.stringify({ schema: 1, results: [{ id: group.id, ready: true }] })
		);
		writeFileSync(path.join(site, 'fixture.json'), JSON.stringify({ group, transfer }));
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
if(args[1]==='plan')writeFileSync(args[flag+1],JSON.stringify({schema:1,groups:[fixture.group]}));
else if(args[1]==='save-products') {
 if(args[args.indexOf('--group')+1]!==fixture.group.id)throw new Error('Unexpected group');
 writeFileSync(args[flag+1],typeof fixture.transfer==='string'?fixture.transfer:JSON.stringify(fixture.transfer));
} else throw new Error('Unexpected transport operation');
`,
			{ mode: 0o755 }
		);
		// Node treats extensionless executable files as CommonJS without this
		// package scope; the fake transport intentionally uses only ESM.
		writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }));
		const sdkCalls = path.join(root, 'sdk-calls.jsonl');
		const transportCalls = path.join(root, 'transport-calls.jsonl');
		const child = spawnSync('node', [action], {
			cwd: root,
			encoding: 'utf8',
			timeout: 10000,
			env: {
				PATH: `${path.dirname(binary)}${path.delimiter}${process.env.PATH ?? ''}`,
				INPUT_MODE: 'save',
				BUILD_CACHE_KEY: 'synthetic-fixture-key',
				GITHUB_REF: 'refs/heads/main',
				GITHUB_EVENT_NAME: 'workflow_dispatch',
				FIXTURE_SDK_CALLS: sdkCalls,
				FIXTURE_TRANSPORT_CALLS: transportCalls
			}
		});
		if (child.error || child.status !== 0)
			throw new Error(
				`Product action fixture failed: ${child.error?.message || child.stderr || child.signal}`
			);
		const calls = (file: string) =>
			existsSync(file)
				? readFileSync(file, 'utf8')
						.trim()
						.split('\n')
						.filter(Boolean)
						.map((line) => JSON.parse(line))
				: [];
		return {
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
			'build/generated/product-caches/save-search-public.json'
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
