import { afterEach, expect, test } from 'bun:test';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import {
	createAssetInventory,
	deploymentAsset,
	validateAssetInventory
} from '../../tooling/lib/deployment-manifest';
import {
	contentHash,
	writeContentIndex,
	writeContentObject,
	type ContentCachePage
} from '../../tooling/lib/content-cache';
import {
	planProductCaches,
	promoteProductFiles,
	transferProductCaches,
	type ProductGroup
} from '../../tooling/lib/product-cache';
import {
	assetHashAlgorithmVersion,
	cachedAssetHashes,
	captureAssetHashes
} from '../../tooling/lib/asset-hash-cache';
import {
	applicationCacheIdentity,
	loadApplicationCache,
	saveApplicationCache
} from '../../tooling/lib/application-cache';
import {
	restoreSearchCache,
	saveSearchCache,
	selectSearchCache
} from '../../tooling/lib/search-cache.js';
import {
	readCourseCache,
	saveCourseCache,
	type CourseCacheRecord
} from '../../tooling/lib/course-cache';

const fixtures: string[] = [];
function fixture() {
	const site = mkdtempSync(path.join(tmpdir(), 'wisconsin-product-test-'));
	fixtures.push(site);
	const cache = path.join(site, 'build/generated/cache');
	mkdirSync(cache, { recursive: true });
	writeFileSync(path.join(site, 'package.json'), '{"name":"product-test","private":true}');
	writeFileSync(path.join(site, 'bun.lock'), 'identical pinned dependency fixture');
	return { site, cache };
}
function content(cache: string) {
	const pages: Record<string, ContentCachePage> = {};
	for (const course of ['alpha', 'beta']) {
		const relative = `${course}/note.md`;
		pages[relative] = {
			parseKey: contentHash(relative),
			summary: {
				rel: relative,
				slug: `${course}/note` as ContentCachePage['summary']['slug'],
				frontmatter: { title: 'Fixture' },
				title: 'Fixture',
				description: '',
				tags: [],
				toc: [],
				draft: false,
				hasMermaid: false,
				wordCount: 2
			},
			outgoing: [],
			transcludes: [],
			parseWarnings: [],
			linkWarnings: [],
			transclusionWarnings: [],
			body: writeContentObject(
				cache,
				'full',
				'bodies',
				JSON.stringify({ html: `PRIVATE FIXTURE ${course}`, markdown: `PRIVATE FIXTURE ${course}` })
			),
			document: writeContentObject(
				cache,
				'full',
				'docs',
				JSON.stringify({ html: `PRIVATE DOCUMENT ${course}` })
			),
			documentKey: contentHash('document ' + relative)
		};
	}
	writeContentIndex(cache, 'full', {
		schema: 1,
		renderer: contentHash('renderer'),
		context: contentHash('context'),
		pages
	});
	return pages;
}
function copyArchives(source: string, target: string) {
	cpSync(
		path.join(source, 'build/generated/product-caches'),
		path.join(target, 'build/generated/product-caches'),
		{ recursive: true }
	);
}
function portableCourse(site: string, cache: string, course = 'alpha') {
	const repo = path.join(site, 'course-fixture');
	const output = path.join(site, 'build/course-fixture');
	const source = Buffer.from('raw source reconstructed from checkout, never archived');
	const blob = `blobs/${contentHash(source)}.bin`;
	const history = `history/${contentHash('history key')}.json`;
	const diff = `history/${contentHash('history key')}-${'a'.repeat(40)}.diff`;
	const files = [
		{
			path: 'dataset.csv',
			size: source.length,
			kind: 'text' as const,
			download: `/_files/${blob}`,
			history: `/_files/${history}`
		}
	];
	const values = new Map([
		[`index/${course}.json`, Buffer.from(JSON.stringify(files))],
		[blob, source],
		[history, Buffer.from('{"revisions":[]}')],
		[diff, Buffer.from('verified history diff')]
	]);
	for (const [relative, bytes] of values) {
		mkdirSync(path.dirname(path.join(output, relative)), { recursive: true });
		writeFileSync(path.join(output, relative), bytes);
		if (relative.startsWith('history/')) {
			const cached = path.join(cache, 'file-history', course, path.basename(relative));
			mkdirSync(path.dirname(cached), { recursive: true });
			writeFileSync(cached, bytes);
		}
	}
	mkdirSync(path.join(repo, 'content', course), { recursive: true });
	writeFileSync(path.join(repo, 'content', course, 'dataset.csv'), source);
	const metadata = `course-files/full/${course}.json`;
	saveCourseCache(
		path.join(cache, metadata),
		contentHash('portable version'),
		files,
		new Set([...values.keys()].map((file) => path.join(output, file))),
		{ repo, course, cache, output }
	);
	writeFileSync(path.join(cache, 'course-files-current-full.json'), JSON.stringify([metadata]));
	writeFileSync(
		path.join(cache, 'history-current.json'),
		JSON.stringify([history, diff].map((file) => `file-history/${course}/${path.basename(file)}`))
	);
	const record = JSON.parse(readFileSync(path.join(cache, metadata), 'utf8')) as CourseCacheRecord;
	return { metadata, record, source, files, values, repo, output };
}
afterEach(() => {
	for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test('concurrent immutable publication keeps one inode and survives a later metadata rollback', async () => {
	const target = fixture();
	const staged = path.join(target.site, 'staged');
	const bytes = Buffer.alloc(8 * 1024 * 1024, 42);
	const shared = `content/full/bodies/${contentHash(bytes)}.json`;
	const entry = { path: shared, bytes: bytes.length, sha256: contentHash(bytes) };
	mkdirSync(path.dirname(path.join(staged, 'files', shared)), { recursive: true });
	writeFileSync(path.join(staged, 'files', shared), bytes);
	const envelope = {
		schema: 1 as const,
		runtime: contentHash('fixture runtime'),
		group: 'course-full-' + contentHash('fixture course').slice(0, 16),
		inputs: contentHash('fixture inputs'),
		files: [entry]
	};
	const module = path.resolve(import.meta.dir, '../../tooling/lib/product-cache.ts');
	const code = `
		import { promoteProductFiles } from ${JSON.stringify(module)};
		import { lstatSync } from 'node:fs';
		process.stdout.write('ready\\n');
		await new Promise(resolve => process.stdin.once('data', resolve));
		promoteProductFiles(${JSON.stringify(target.cache)}, ${JSON.stringify(staged)}, ${JSON.stringify(envelope)});
		console.log(String(lstatSync(${JSON.stringify(path.join(target.cache, shared))}, { bigint: true }).ino));
	`;
	const workers = Array.from({ length: 4 }, () => {
		const child = spawn(process.execPath, ['--eval', code], { stdio: ['pipe', 'pipe', 'pipe'] });
		let output = '';
		let errors = '';
		let ready!: () => void;
		const started = new Promise<void>((resolve) => {
			ready = resolve;
		});
		child.stdout.on('data', (chunk) => {
			output += chunk;
			if (output.includes('ready\n')) ready();
		});
		child.stderr.on('data', (chunk) => {
			errors += chunk;
		});
		const finished = new Promise<string>((resolve, reject) => {
			child.once('error', reject);
			child.once('close', (exit) => {
				ready();
				if (exit === 0) resolve(output.trim().split('\n').at(-1)!);
				else reject(new Error(errors || `Publication worker exited ${exit}`));
			});
		});
		return { child, started, finished };
	});
	try {
		await Promise.all(workers.map((worker) => worker.started));
		for (const worker of workers) worker.child.stdin.end('publish');
		const inodes = await Promise.all(workers.map((worker) => worker.finished));
		expect(new Set(inodes).size).toBe(1);
		expect(readFileSync(path.join(target.cache, shared))).toEqual(bytes);

		const retainedBytes = Buffer.from('another verified immutable object');
		const retained = `content/full/docs/${contentHash(retainedBytes)}.json`;
		mkdirSync(path.dirname(path.join(staged, 'files', retained)), { recursive: true });
		writeFileSync(path.join(staged, 'files', retained), retainedBytes);
		writeFileSync(path.join(target.cache, 'content-current-full.json'), 'prior metadata');
		writeFileSync(path.join(staged, 'files/content-current-full.json'), 'replacement metadata');
		expect(() =>
			promoteProductFiles(target.cache, staged, {
				...envelope,
				files: [
					entry,
					{ path: retained, bytes: retainedBytes.length, sha256: contentHash(retainedBytes) },
					{
						path: 'content-current-full.json',
						bytes: 20,
						sha256: contentHash('replacement metadata')
					},
					{ path: 'content-files-current-full.json', bytes: 2, sha256: contentHash('[]') }
				]
			})
		).toThrow();
		expect(readFileSync(path.join(target.cache, 'content-current-full.json'), 'utf8')).toBe(
			'prior metadata'
		);
		expect(readFileSync(path.join(target.cache, retained))).toEqual(retainedBytes);
		expect(String(lstatSync(path.join(target.cache, shared), { bigint: true }).ino)).toBe(
			inodes[0]
		);
	} finally {
		for (const worker of workers) worker.child.kill();
	}
}, 30_000);

test('product planning separates compact globals and exact immutable course groups, with portable keys', async () => {
	const source = fixture();
	const other = fixture();
	content(source.cache);
	content(other.cache);
	mkdirSync(path.join(source.cache, 'stage1'));
	writeFileSync(path.join(source.cache, 'stage1', 'huge-unused.json'), 'PRIVATE OLD AST');
	const first = await planProductCaches(source.site);
	const second = await planProductCaches(other.site);
	expect(first.runtime).toBe(second.runtime);
	expect(
		first.groups.map(({ id, key, inputs, restoreKeys }) => ({ id, key, inputs, restoreKeys }))
	).toEqual(
		second.groups.map(({ id, key, inputs, restoreKeys }) => ({ id, key, inputs, restoreKeys }))
	);
	expect(first.groups).toHaveLength(3);
	expect(first.groups.find((group) => group.id === 'global-full')!.restoreKeys).toHaveLength(1);
	expect(
		first.groups
			.filter((group) => group.id.startsWith('course-'))
			.every((group) => !group.restoreKeys.length)
	).toBe(true);
	const cold = await planProductCaches(fixture().site, { restore: true, kind: 'global' });
	expect(cold.groups.map((group) => group.id)).toEqual([
		'files-global-full',
		'files-global-public',
		'global-full',
		'global-public'
	]);
});

test('cold one-shot restoration replans exact course products after authenticating global indexes', async () => {
	const source = fixture();
	const target = fixture();
	const pages = content(source.cache);
	const secret = randomBytes(32).toString('hex');
	rmSync(path.join(target.site, 'build'), { recursive: true });
	const cold = await planProductCaches(target.site, { restore: true });
	expect(cold.groups.map((group) => group.id)).toEqual([
		'application',
		'files-global-full',
		'files-global-public',
		'global-full',
		'global-public',
		'search-full',
		'search-public'
	]);
	expect(
		cold.groups
			.filter((group) => group.id !== 'application')
			.every(
				(group) => group.restoreKeys.length === 1 && group.restoreKeys[0].includes(cold.runtime)
			)
	).toBe(true);
	expect(cold.groups.find((group) => group.id === 'application')!.restoreKeys).toEqual([]);
	expect(existsSync(target.cache)).toBe(false);
	expect(
		(await transferProductCaches(source.site, 'save', secret)).results.every(
			(result) => result.ready
		)
	).toBe(true);
	copyArchives(source.site, target.site);
	const restored = await transferProductCaches(target.site, 'restore', secret);
	expect(restored.results.filter((result) => result.ready)).toHaveLength(3);
	expect(
		restored.results
			.filter((result) => result.id.startsWith('course-'))
			.every((result) => result.ready)
	).toBe(true);
	for (const page of Object.values(pages))
		for (const file of [page.body!, page.document!])
			expect(readFileSync(path.join(target.cache, file))).toEqual(
				readFileSync(path.join(source.cache, file))
			);
}, 30_000);

test('portable course metadata and exact history closure restore without archiving raw source assets', async () => {
	const source = fixture();
	const target = fixture();
	const course = portableCourse(source.site, source.cache);
	const secret = randomBytes(32).toString('hex');
	const plan = await planProductCaches(source.site);
	expect(plan.groups.map((group) => group.id)).toEqual([
		`course-files-full-${contentHash('alpha').slice(0, 16)}`,
		'files-global-full'
	]);
	expect(plan.groups[0].restoreKeys).toEqual([]);
	expect(
		(await transferProductCaches(source.site, 'save', secret)).results.every(
			(result) => result.ready
		)
	).toBe(true);
	rmSync(path.join(target.site, 'build'), { recursive: true });
	copyArchives(source.site, target.site);
	const restored = await transferProductCaches(target.site, 'restore', secret);
	expect(restored.results.filter((result) => result.ready).map((result) => result.id)).toEqual([
		'files-global-full',
		`course-files-full-${contentHash('alpha').slice(0, 16)}`
	]);
	expect(readFileSync(path.join(target.cache, course.metadata))).toEqual(
		readFileSync(path.join(source.cache, course.metadata))
	);
	for (const [relative, bytes] of course.values) {
		if (relative.startsWith('history/'))
			expect(
				readFileSync(path.join(target.cache, 'file-history/alpha', path.basename(relative)))
			).toEqual(bytes);
		else expect(existsSync(path.join(target.cache, relative))).toBe(false);
	}
	const repo = path.join(target.site, 'fresh-checkout');
	const output = path.join(target.site, 'fresh-output');
	mkdirSync(path.join(repo, 'content/alpha'), { recursive: true });
	mkdirSync(output);
	writeFileSync(path.join(repo, 'content/alpha/dataset.csv'), course.source);
	expect(
		readCourseCache(path.join(target.cache, course.metadata), course.record.fingerprint, {
			repo,
			output,
			cache: target.cache,
			course: 'alpha'
		})?.files
	).toEqual(course.files);
	for (const [relative, bytes] of course.values)
		expect(readFileSync(path.join(output, relative))).toEqual(bytes);
}, 30_000);

test('targeted course planning validates its own complete closure without parsing unrelated metadata', async () => {
	const source = fixture();
	content(source.cache);
	const alpha = portableCourse(source.site, source.cache, 'alpha');
	const beta = portableCourse(source.site, source.cache, 'beta');
	writeFileSync(
		path.join(source.cache, 'course-files-current-full.json'),
		JSON.stringify([alpha.metadata, beta.metadata])
	);
	const all = await planProductCaches(source.site);
	const fileId = `course-files-full-${contentHash('alpha').slice(0, 16)}`;
	const bodyId = `course-full-${contentHash('alpha').slice(0, 16)}`;
	const expectedFiles = all.groups.find((group) => group.id === fileId)!;
	const expectedBodies = all.groups.find((group) => group.id === bodyId)!;
	writeFileSync(path.join(source.cache, beta.metadata), 'unrelated corrupt metadata');
	expect((await planProductCaches(source.site, { group: fileId })).groups).toEqual([expectedFiles]);
	expect((await planProductCaches(source.site, { group: bodyId })).groups).toEqual([
		expectedBodies
	]);
	expect((await planProductCaches(source.site, { group: 'files-global-full' })).groups).toEqual([]);
	writeFileSync(path.join(source.cache, alpha.metadata), 'requested corrupt metadata');
	expect((await planProductCaches(source.site, { group: fileId })).groups).toEqual([]);
	expect((await planProductCaches(source.site, { group: bodyId, kind: 'search' })).groups).toEqual(
		[]
	);
});

test('portable metadata selection excludes R and old records and rejects incomplete or corrupted history before publication', async () => {
	const source = fixture();
	const target = fixture();
	const course = portableCourse(source.site, source.cache);
	const secret = randomBytes(32).toString('hex');
	const plan = await planProductCaches(source.site);
	const group = plan.groups.find((group) => group.id.startsWith('course-files-'))!;
	await transferProductCaches(source.site, 'save', secret);
	copyArchives(source.site, target.site);
	await transferProductCaches(target.site, 'restore', secret, { group: 'files-global-full' });
	const before = readFileSync(path.join(target.cache, course.metadata));
	const bytes = readFileSync(path.join(source.cache, course.metadata));
	const entry = { path: course.metadata, bytes: bytes.length, sha256: contentHash(bytes) };
	crafted(
		{
			...group,
			archive: path.join(target.site, 'build/generated/product-caches', `${group.id}.gpg`)
		},
		plan.runtime,
		secret,
		[entry],
		bytes
	);
	expect(
		(await transferProductCaches(target.site, 'restore', secret, { group: group.id })).results[0]
			.reason
	).toBe('invalid');
	expect(readFileSync(path.join(target.cache, course.metadata))).toEqual(before);
	expect(existsSync(path.join(target.cache, 'file-history'))).toBe(false);
	const historyOutputs = course.record.outputs.filter((entry) => entry.origin.kind === 'history');
	const historyPayloads = historyOutputs.map((output, index) =>
		index === 0
			? Buffer.from('authenticated but wrong history bytes')
			: readFileSync(path.join(source.cache, (output.origin as { cachePath: string }).cachePath))
	);
	crafted(
		{
			...group,
			archive: path.join(target.site, 'build/generated/product-caches', `${group.id}.gpg`)
		},
		plan.runtime,
		secret,
		[
			entry,
			...historyOutputs.map((output, index) => ({
				path: (output.origin as { cachePath: string }).cachePath,
				bytes: historyPayloads[index].length,
				sha256: contentHash(historyPayloads[index])
			}))
		],
		Buffer.concat([bytes, ...historyPayloads])
	);
	expect(
		(await transferProductCaches(target.site, 'restore', secret, { group: group.id })).results[0]
			.reason
	).toBe('invalid');
	expect(readFileSync(path.join(target.cache, course.metadata))).toEqual(before);
	expect(existsSync(path.join(target.cache, 'file-history'))).toBe(false);
	const selectedHistory = readFileSync(path.join(source.cache, 'history-current.json'));
	writeFileSync(path.join(source.cache, 'history-current.json'), '[]');
	expect(
		(await transferProductCaches(source.site, 'save', secret, { group: group.id })).results[0]
			.reason
	).toBe('invalid');
	writeFileSync(path.join(source.cache, 'history-current.json'), selectedHistory);
	const history = course.record.outputs.find((entry) => entry.origin.kind === 'history')!;
	writeFileSync(
		path.join(source.cache, (history.origin as { cachePath: string }).cachePath),
		'corrupted cache'
	);
	expect(
		(await transferProductCaches(source.site, 'save', secret, { group: group.id })).results[0]
			.reason
	).toBe('invalid');
	const excluded = {
		...course.record,
		files: [{ ...course.files[0], path: 'worksheet.Rmd', rmdPreview: '/_rmd/fixture.json' }]
	};
	excluded.payloadSha256 = contentHash(
		JSON.stringify([
			excluded.version,
			excluded.course,
			excluded.fingerprint,
			excluded.files,
			excluded.outputs
		])
	);
	writeFileSync(path.join(source.cache, course.metadata), JSON.stringify(excluded));
	expect((await planProductCaches(source.site)).groups).toEqual([]);
	writeFileSync(
		path.join(source.cache, course.metadata),
		JSON.stringify({ version: 1, course: 'alpha' })
	);
	expect((await planProductCaches(source.site)).groups).toEqual([]);
}, 30_000);

test('benchmark keys and authenticated envelopes remain separate from production caches', async () => {
	const source = fixture();
	const target = fixture();
	content(source.cache);
	const secret = randomBytes(32).toString('hex');
	const production = await planProductCaches(source.site, { group: 'global-full' });
	const benchmark = await planProductCaches(source.site, {
		group: 'global-full',
		namespace: 'benchmark'
	});
	expect(benchmark.runtime).toBe(production.runtime);
	expect(benchmark.groups[0].key).toContain('wisconsin-products-benchmark-v1-');
	expect(production.groups[0].key).toContain('wisconsin-products-v1-');
	expect(benchmark.groups[0].key).not.toBe(production.groups[0].key);
	expect(benchmark.groups[0].archive).not.toBe(production.groups[0].archive);
	expect(benchmark.groups[0].restoreKeys[0]).not.toBe(production.groups[0].restoreKeys[0]);
	expect(
		(
			await transferProductCaches(source.site, 'save', secret, {
				namespace: 'benchmark',
				group: 'global-full'
			})
		).results[0].ready
	).toBe(true);
	copyArchives(source.site, target.site);
	expect(
		(await transferProductCaches(target.site, 'restore', secret, { group: 'global-full' }))
			.results[0].reason
	).toBe('miss');
	const prodTarget = (await planProductCaches(target.site, { restore: true, group: 'global-full' }))
		.groups[0];
	const benchTarget = (
		await planProductCaches(target.site, {
			restore: true,
			namespace: 'benchmark',
			group: 'global-full'
		})
	).groups[0];
	cpSync(benchTarget.archive, prodTarget.archive);
	expect(
		(await transferProductCaches(target.site, 'restore', secret, { group: 'global-full' }))
			.results[0].reason
	).toBe('invalid');
	expect(existsSync(path.join(target.cache, 'content-current-full.json'))).toBe(false);
	expect(
		(
			await transferProductCaches(target.site, 'restore', secret, {
				namespace: 'benchmark',
				group: 'global-full'
			})
		).results[0].ready
	).toBe(true);
	const prior = readFileSync(path.join(target.cache, 'content-current-full.json'));
	expect(
		(await transferProductCaches(source.site, 'save', secret, { group: 'global-full' })).results[0]
			.ready
	).toBe(true);
	cpSync(production.groups[0].archive, benchTarget.archive);
	expect(
		(
			await transferProductCaches(target.site, 'restore', secret, {
				namespace: 'benchmark',
				group: 'global-full'
			})
		).results[0].reason
	).toBe('invalid');
	expect(readFileSync(path.join(target.cache, 'content-current-full.json'))).toEqual(prior);
}, 30_000);

test('authenticated segments restore globals then exact course closure into a fresh relocated cache', async () => {
	const source = fixture();
	const target = fixture();
	const pages = content(source.cache);
	const secret = randomBytes(32).toString('hex');
	const save = await transferProductCaches(source.site, 'save', secret);
	expect(save.results).toHaveLength(3);
	expect(save.results.every((result) => result.ready)).toBe(true);
	copyArchives(source.site, target.site);
	const archive = readFileSync(
		path.join(target.site, 'build/generated/product-caches/global-full.gpg')
	);
	expect(archive.includes(Buffer.from('PRIVATE FIXTURE'))).toBe(false);
	const global = await transferProductCaches(target.site, 'restore', secret, {
		group: 'global-full'
	});
	expect(global.results[0].ready).toBe(true);
	for (const page of Object.values(pages))
		expect(existsSync(path.join(target.cache, page.body!))).toBe(false);
	const restored = await transferProductCaches(target.site, 'restore', secret, { kind: 'course' });
	expect(restored.results).toHaveLength(2);
	expect(restored.results.every((result) => result.ready)).toBe(true);
	const inventory = JSON.parse(
		readFileSync(path.join(target.cache, 'deployment-hashes.json'), 'utf8')
	);
	const records = new Map<string, { sha256: string; stamp: string }>(inventory.entries);
	for (const page of Object.values(pages))
		for (const file of [page.body!, page.document!]) {
			expect(readFileSync(path.join(target.cache, file))).toEqual(
				readFileSync(path.join(source.cache, file))
			);
			const absolute = path.join(target.cache, file);
			const record = records.get(absolute)!;
			expect(record.sha256).toBe(path.basename(file, '.json'));
			const stat = lstatSync(absolute, { bigint: true });
			expect(JSON.parse(record.stamp)).toEqual(
				[stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].map(String)
			);
			// Recent files conservatively bypass cached hashes; capture remains correct.
			expect(captureAssetHashes(target.site, absolute).sha256).toBe(record.sha256);
		}
	expect(existsSync(path.join(target.cache, 'stage1'))).toBe(false);
	expect(existsSync(path.join(target.cache, 'deployment-hashes.json'))).toBe(true);
}, 30_000);

test('neutral prepared app and complete search products survive independent fresh-cache restoration', async () => {
	const source = fixture();
	const target = fixture();
	const secret = randomBytes(32).toString('hex');
	for (const [file, bytes] of Object.entries({
		'worker.js': 'neutral wrapper',
		'svelte-worker.js': 'neutral server',
		'prepared-worker/worker.json': '{"modules":[]}',
		'cloudflare/_app/immutable/manifest.json': '{"client":"nested manifest is payload"}',
		'server/.vite/manifest.json': '{"server":"nested manifest is payload"}',
		'cloudflare/_app/client.js': 'neutral client'
	})) {
		const output = path.join(source.site, 'build/.svelte-kit', file);
		mkdirSync(path.dirname(output), { recursive: true });
		writeFileSync(output, bytes);
	}
	const identity = applicationCacheIdentity(source.site);
	expect(applicationCacheIdentity(target.site).identity).toBe(identity.identity);
	const applicationAssets = createAssetInventory(
		{ '/_app/client.js': deploymentAsset(Buffer.from('neutral client'), '/_app/client.js') },
		identity.identity
	);
	writeFileSync(
		path.join(source.site, 'build/.svelte-kit/application-assets.json'),
		JSON.stringify(applicationAssets)
	);
	saveApplicationCache(source.site, identity);
	const search = path.join(source.site, 'build/search-fixture');
	mkdirSync(search);
	writeFileSync(path.join(search, 'pagefind.js'), 'search client');
	writeFileSync(path.join(search, 'pagefind-entry.json'), '{}');
	writeFileSync(path.join(search, 'manifest.json'), '{"nested":"search payload"}');
	const key = contentHash('exact search input');
	selectSearchCache(source.cache, 'full', saveSearchCache(source.cache, search, key, 'full'));
	const saved = await transferProductCaches(source.site, 'save', secret);
	expect(saved.results.map((item) => item.id)).toEqual(['application', 'search-full']);
	expect(saved.results.every((item) => item.ready)).toBe(true);
	rmSync(path.join(target.site, 'build'), { recursive: true });
	copyArchives(source.site, target.site);
	const restored = await transferProductCaches(target.site, 'restore', secret);
	expect(restored.results.filter((item) => item.ready).map((item) => item.id)).toEqual([
		'application',
		'search-full'
	]);
	expect(
		loadApplicationCache(target.site, applicationCacheIdentity(target.site))?.manifest.identity
	).toBe(identity.identity);
	const restoredApplication = loadApplicationCache(
		target.site,
		applicationCacheIdentity(target.site)
	)!;
	expect(
		validateAssetInventory(
			JSON.parse(
				readFileSync(
					path.join(restoredApplication.directory, 'kit/application-assets.json'),
					'utf8'
				)
			),
			identity.identity
		).digest
	).toBe(applicationAssets.digest);
	const output = path.join(target.site, 'build/search-output');
	expect(restoreSearchCache(path.join(target.cache, 'search/full', key), output, key, 'full')).toBe(
		true
	);
	expect(readFileSync(path.join(output, 'pagefind.js'), 'utf8')).toBe('search client');
	expect(readFileSync(path.join(output, 'manifest.json'), 'utf8')).toBe(
		'{"nested":"search payload"}'
	);
}, 30_000);

test('wrong keys, tampering and incompatible runtime fail cold without overwriting prior cache metadata', async () => {
	const source = fixture();
	const target = fixture();
	content(source.cache);
	const secret = randomBytes(32).toString('hex');
	await transferProductCaches(source.site, 'save', secret, { group: 'global-full' });
	copyArchives(source.site, target.site);
	const pointer = path.join(target.cache, 'content-current-full.json');
	writeFileSync(pointer, 'PRIOR CACHE CONTENT');
	const before = readFileSync(pointer);
	expect(
		(await transferProductCaches(target.site, 'restore', 'wrong-key', { group: 'global-full' }))
			.results[0].reason
	).toBe('invalid');
	expect(readFileSync(pointer)).toEqual(before);
	const encrypted = path.join(target.site, 'build/generated/product-caches/global-full.gpg');
	const bytes = readFileSync(encrypted);
	const corrupted = Buffer.from(bytes);
	corrupted[corrupted.length - 1] ^= 1;
	writeFileSync(encrypted, corrupted);
	expect(
		(await transferProductCaches(target.site, 'restore', secret, { group: 'global-full' }))
			.results[0].reason
	).toBe('invalid');
	expect(readFileSync(pointer)).toEqual(before);
	writeFileSync(encrypted, bytes);
	writeFileSync(path.join(target.site, 'bun.lock'), 'different dependency runtime');
	expect(
		(await transferProductCaches(target.site, 'restore', secret, { group: 'global-full' }))
			.results[0].reason
	).toBe('invalid');
	expect(readFileSync(pointer)).toEqual(before);
}, 30_000);

function crafted(
	group: ProductGroup,
	runtime: string,
	secret: string,
	files: {
		path: string;
		bytes: number;
		sha256: string;
		assetHash?: string;
		assetHashVersion?: string;
	}[],
	bytes = Buffer.alloc(0)
) {
	const root = mkdtempSync(path.join(tmpdir(), 'wisconsin-crafted-product-'));
	fixtures.push(root);
	const metadata = Buffer.from(
		JSON.stringify({ schema: 1, runtime, group: group.id, inputs: group.inputs, files })
	);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(metadata.length);
	const input = path.join(root, 'payload.gz');
	writeFileSync(
		input,
		gzipSync(Buffer.concat([Buffer.from('WISCONSIN_PRODUCT_CACHE_1\n'), length, metadata, bytes]))
	);
	mkdirSync(path.dirname(group.archive), { recursive: true });
	const environment = { ...process.env, GNUPGHOME: root };
	try {
		execFileSync(
			'gpg',
			[
				'--batch',
				'--yes',
				'--pinentry-mode',
				'loopback',
				'--no-symkey-cache',
				'--passphrase-fd',
				'0',
				'--symmetric',
				'--cipher-algo',
				'AES256',
				'--compress-algo',
				'none',
				'--force-mdc',
				'--output',
				group.archive,
				input
			],
			{ env: environment, input: secret + '\n', stdio: 'pipe' }
		);
	} finally {
		try {
			execFileSync('gpgconf', ['--kill', 'gpg-agent'], { env: environment, stdio: 'pipe' });
		} catch {}
	}
}

test('authenticated archives reject traversal, unowned paths, duplicates, oversized entries and wrong byte hashes before publishing', async () => {
	const target = fixture();
	const secret = randomBytes(32).toString('hex');
	const plan = await planProductCaches(target.site, { restore: true, group: 'global-full' });
	const group = plan.groups[0];
	const bytes = Buffer.from('owned fixture');
	const base = {
		path: 'content-current-full.json',
		bytes: bytes.length,
		sha256: contentHash(bytes)
	};
	for (const entries of [
		[{ ...base, path: '../../outside' }],
		[{ ...base, path: 'credentials.env' }],
		[base, base],
		[{ ...base, bytes: 128 * 1024 * 1024 + 1 }],
		[{ ...base, sha256: '0'.repeat(64) }]
	]) {
		crafted(group, plan.runtime, secret, entries, bytes);
		expect(
			(await transferProductCaches(target.site, 'restore', secret, { group: group.id })).results[0]
				.reason
		).toBe('invalid');
		expect(existsSync(path.join(target.cache, base.path))).toBe(false);
	}
}, 30_000);

test('authenticated wrong Wrangler metadata and missing closure files fail before local hash reuse', async () => {
	const target = fixture();
	const pages = content(target.cache);
	const secret = randomBytes(32).toString('hex');
	const plan = await planProductCaches(target.site, { group: 'global-full' });
	const names = ['content-current-full.json', 'content-files-current-full.json'];
	const buffers = names.map((name) => readFileSync(path.join(target.cache, name)));
	const entries = names.map((name, i) => ({
		path: name,
		bytes: buffers[i].length,
		sha256: contentHash(buffers[i])
	}));
	const before = readFileSync(path.join(target.cache, names[0]));
	crafted(
		plan.groups[0],
		plan.runtime,
		secret,
		[
			{ ...entries[0], assetHash: '0'.repeat(32), assetHashVersion: assetHashAlgorithmVersion },
			entries[1]
		],
		Buffer.concat(buffers)
	);
	expect(
		(await transferProductCaches(target.site, 'restore', secret, { group: 'global-full' }))
			.results[0].reason
	).toBe('invalid');
	expect(readFileSync(path.join(target.cache, names[0]))).toEqual(before);
	expect(cachedAssetHashes(target.site, path.join(target.cache, names[0]))).toBeUndefined();
	crafted(
		{ ...plan.groups[0], inputs: '0'.repeat(64) },
		plan.runtime,
		secret,
		entries,
		Buffer.concat(buffers)
	);
	expect(
		(await transferProductCaches(target.site, 'restore', secret, { group: 'global-full' }))
			.results[0].reason
	).toBe('invalid');
	expect(readFileSync(path.join(target.cache, names[0]))).toEqual(before);
	crafted(plan.groups[0], plan.runtime, secret, [entries[0]], buffers[0]);
	expect(
		(await transferProductCaches(target.site, 'restore', secret, { group: 'global-full' }))
			.results[0].reason
	).toBe('invalid');
	expect(readFileSync(path.join(target.cache, names[0]))).toEqual(before);
	expect(Object.keys(pages)).toHaveLength(2);
}, 30_000);

test('symlinked cache sources and destination ancestors cannot be transported or overwritten', async () => {
	const source = fixture();
	const target = fixture();
	const outside = fixture();
	const pages = content(source.cache);
	const secret = randomBytes(32).toString('hex');
	await transferProductCaches(source.site, 'save', secret);
	copyArchives(source.site, target.site);
	await transferProductCaches(target.site, 'restore', secret, { group: 'global-full' });
	mkdirSync(path.join(target.cache, 'content/full'), { recursive: true });
	symlinkSync(outside.cache, path.join(target.cache, 'content/full/bodies'));
	const result = await transferProductCaches(target.site, 'restore', secret, { kind: 'course' });
	expect(result.results.every((item) => !item.ready && item.reason === 'invalid')).toBe(true);
	for (const page of Object.values(pages))
		expect(existsSync(path.join(outside.cache, path.basename(page.body!)))).toBe(false);
	const body = Object.values(pages)[0].body!;
	rmSync(path.join(source.cache, body));
	symlinkSync(path.join(outside.cache, 'missing'), path.join(source.cache, body));
	expect(
		(await transferProductCaches(source.site, 'save', secret, { kind: 'course' })).results.some(
			(item) => item.reason === 'invalid'
		)
	).toBe(true);
}, 30_000);
