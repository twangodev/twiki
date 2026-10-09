import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	closeSync,
	copyFileSync,
	createReadStream,
	createWriteStream,
	existsSync,
	lstatSync,
	linkSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	readSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
	writeSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { readContentIndex, type ContentEdition } from './content-cache';
import { parseCourseCache, type CourseCacheRecord } from './course-cache';
import { historyCachePath } from './cache-selection';
import {
	assetHashAlgorithmVersion,
	captureAssetHashes,
	rememberVerifiedAsset,
	flushAssetHashCache
} from './asset-hash-cache';
import { wranglerAssetHash } from './deployment-manifest';

const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sha = /^[a-f0-9]{64}$/;
const magic = Buffer.from('WISCONSIN_PRODUCT_CACHE_1\n');
const maximumManifest = 8 * 1024 * 1024;
const maximumEntry = 128 * 1024 * 1024;
const maximumPayload = 512 * 1024 * 1024;
const maximumFiles = 100_000;
export type ProductKind = 'global' | 'course' | 'search' | 'application';
export type ProductNamespace = 'production' | 'benchmark';
export interface ProductGroup {
	id: string;
	key: string;
	archive: string;
	inputs: string;
	restoreKeys: string[];
	namespace?: ProductNamespace;
}
export interface ProductPlan {
	schema: 1;
	namespace: ProductNamespace;
	runtime: string;
	groups: ProductGroup[];
}
interface Selection extends ProductGroup {
	files: string[];
	kind: ProductKind;
}
interface Entry {
	path: string;
	bytes: number;
	sha256: string;
	assetHash?: string;
	assetHashVersion?: string;
}
interface Envelope {
	schema: 1;
	runtime: string;
	group: string;
	inputs: string;
	files: Entry[];
	namespace?: ProductNamespace;
}
export interface ProductOptions {
	restore?: boolean;
	kind?: ProductKind;
	group?: string;
	namespace?: ProductNamespace;
}

function safeRelative(file: unknown): file is string {
	return (
		typeof file === 'string' &&
		file.length < 4096 &&
		!/[\\:\x00-\x1f\x7f]/.test(file) &&
		file.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
	);
}
function regular(cache: string, relative: string) {
	if (!safeRelative(relative)) throw new Error('Unsafe cache path');
	const file = path.join(cache, relative);
	if (!lstatSync(file).isFile() || realpathSync(file) !== file)
		throw new Error('Nonregular cache file');
	return file;
}
function readJson(cache: string, file: string) {
	return JSON.parse(readFileSync(regular(cache, file), 'utf8'));
}
function sameFiles(actual: unknown, expected: string[]) {
	return (
		Array.isArray(actual) &&
		actual.length === expected.length &&
		actual.every((file) => typeof file === 'string') &&
		JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
	);
}
function idKind(id: string): ProductKind | undefined {
	if (/^(?:global|files-global)-(?:public|full)$/.test(id)) return 'global';
	if (/^course-(?:files-)?(?:public|full)-[a-f0-9]{16}$/.test(id)) return 'course';
	if (/^search-(?:public|full)$/.test(id)) return 'search';
	if (id === 'application') return 'application';
}
const groupEdition = (id: string) => id.match(/(?:^|-)(public|full)(?:-|$)/)?.[1] as ContentEdition;
const courseMetadataPath = /^course-files\/(public|full)\/([\w-]+)\.json$/;
function ownedFile(id: string, file: string) {
	if (!safeRelative(file)) return false;
	const kind = idKind(id);
	const edition = groupEdition(id);
	if (id.startsWith('files-global-'))
		return (
			file === `course-files-current-${edition}.json` ||
			(courseMetadataPath.test(file) && courseMetadataPath.exec(file)![1] === edition)
		);
	if (id.startsWith('course-files-'))
		return (
			(courseMetadataPath.test(file) && courseMetadataPath.exec(file)![1] === edition) ||
			historyCachePath.test(file)
		);
	if (kind === 'global')
		return [`content-current-${edition}.json`, `content-files-current-${edition}.json`].includes(
			file
		);
	if (kind === 'course')
		return new RegExp(`^content/${edition}/(?:bodies|docs)/[a-f0-9]{64}\\.json$`).test(file);
	if (kind === 'search')
		return (
			file === `search-current-${edition}.json` ||
			new RegExp(`^search/${edition}/[a-f0-9]{64}/(?:manifest\\.json|files/.+)$`).test(file)
		);
	if (kind === 'application')
		return (
			file === 'application-current.json' ||
			/^application\/[a-f0-9]{64}\/(?:manifest\.json|kit\/.+)$/.test(file)
		);
	return false;
}
const mutable = (file: string) => !file.includes('/') || courseMetadataPath.test(file);

function courseMetadata(cache: string, file: string, edition: ContentEdition) {
	const match = courseMetadataPath.exec(file);
	if (!match || match[1] !== edition) throw new Error('Invalid portable course metadata path');
	const record = parseCourseCache(readJson(cache, file), match[2]);
	if (!record || record.files.some((entry) => /\.rmd$/i.test(entry.path)))
		throw new Error('Invalid portable course metadata');
	return record;
}
function courseHistory(record: CourseCacheRecord) {
	const history = new Map<string, { path: string; bytes: number; sha256: string }>();
	for (const output of record.outputs) {
		if (output.origin.kind !== 'history') continue;
		const entry = { path: output.origin.cachePath, bytes: output.bytes, sha256: output.sha256 };
		if (history.has(entry.path)) throw new Error('Duplicate course history dependency');
		history.set(entry.path, entry);
	}
	return [...history.values()].sort((a, b) => a.path.localeCompare(b.path));
}
function fileSelection(
	cache: string,
	edition: ContentEdition,
	selected: (course: string) => boolean = () => true
) {
	const selector = `course-files-current-${edition}.json`;
	const files = readJson(cache, selector);
	if (
		!Array.isArray(files) ||
		new Set(files).size !== files.length ||
		!files.every(
			(file) =>
				typeof file === 'string' && ownedFile(`files-global-${edition}`, file) && file !== selector
		)
	)
		throw new Error('Invalid portable course selection');
	return {
		selector,
		records: files
			.filter((file: string) => selected(courseMetadataPath.exec(file)![2]))
			.sort()
			.map((file: string) => ({ file, record: courseMetadata(cache, file, edition) }))
	};
}
function fileGlobalInputs(cache: string, files: string[]) {
	return digest(
		JSON.stringify(
			[...files].sort().map((file) => [file, digest(readFileSync(regular(cache, file)))])
		)
	);
}
function fileCourseInputs(
	cache: string,
	file: string,
	record: CourseCacheRecord,
	edition: ContentEdition
) {
	return digest(
		JSON.stringify([
			edition,
			record.course,
			digest(readFileSync(regular(cache, file))),
			courseHistory(record)
		])
	);
}

function directoryParents(directory: string, root: string) {
	for (
		let current = directory;
		current === root || current.startsWith(root + path.sep);
		current = path.dirname(current)
	) {
		const information = lstatSync(current, { throwIfNoEntry: false });
		if (information && (!information.isDirectory() || realpathSync(current) !== current))
			throw new Error('Unsafe cache directory');
		if (current === root) break;
	}
}

/** Transport compatibility supplements producer-specific renderer/input checks. */
export function productRuntimeIdentity(site: string) {
	return digest(
		JSON.stringify([
			'product-cache-runtime-v1',
			process.platform,
			process.arch,
			process.version,
			process.versions.bun ?? '',
			execFileSync('node', ['--version'], { encoding: 'utf8', stdio: 'pipe' }).trim(),
			digest(readFileSync(path.join(site, 'bun.lock'))),
			digest(readFileSync(path.join(site, 'package.json')))
		])
	);
}

async function selections(site: string, options: ProductOptions = {}) {
	const namespace = options.namespace ?? 'production';
	if (!['production', 'benchmark'].includes(namespace))
		throw new Error('Invalid product namespace');
	const runtime = productRuntimeIdentity(site);
	const cache = path.resolve(site, 'build/generated/cache');
	if (existsSync(cache) && realpathSync(cache) !== cache) throw new Error('Nonregular cache root');
	const groups: Selection[] = [];
	const wanted = (id: string) =>
		(!options.group || options.group === id) && (!options.kind || options.kind === idKind(id));
	const wantedCourses = (prefix: string) =>
		(!options.kind || options.kind === 'course') &&
		(!options.group || (options.group.startsWith(prefix) && idKind(options.group) === 'course'));
	const add = (id: string, inputs: string, files: string[], exact = false) => {
		if (!wanted(id)) return;
		const kind = idKind(id);
		if (!kind || !sha.test(inputs) || !files.every((file) => ownedFile(id, file)))
			throw new Error('Invalid product selection');
		const prefix = `wisconsin-products-${namespace === 'production' ? '' : 'benchmark-'}v1-${runtime}-${id}-`;
		groups.push({
			id,
			kind,
			namespace,
			inputs,
			key: prefix + inputs,
			restoreKeys: exact ? [] : [prefix],
			archive: path.resolve(
				site,
				'build/generated/product-caches',
				...(namespace === 'benchmark' ? ['benchmark'] : []),
				`${id}.gpg`
			),
			files: [...new Set(files)].sort()
		});
	};
	for (const edition of ['public', 'full'] as ContentEdition[]) {
		if (wanted(`global-${edition}`) || wantedCourses(`course-${edition}-`)) {
			try {
				const indexName = `content-current-${edition}.json`;
				const listName = `content-files-current-${edition}.json`;
				const candidate = readJson(cache, indexName);
				if (!sha.test(candidate.renderer)) throw new Error('Invalid content renderer');
				const index = readContentIndex(cache, edition, candidate.renderer);
				if (!index) throw new Error('Invalid content index');
				const references = [
					...new Set([
						indexName,
						...Object.values(index.pages).flatMap((page) =>
							[page.body, page.document].filter((file): file is string => !!file)
						)
					])
				];
				if (!sameFiles(readJson(cache, listName), references))
					throw new Error('Incomplete content selection');
				if (wanted(`global-${edition}`))
					add(
						`global-${edition}`,
						digest(
							Buffer.concat([
								readFileSync(regular(cache, indexName)),
								readFileSync(regular(cache, listName))
							])
						),
						[indexName, listName]
					);
				if (wantedCourses(`course-${edition}-`)) {
					const courses = new Map<string, Set<string>>();
					for (const page of Object.values(index.pages)) {
						const course = page.summary.rel.includes('/')
							? page.summary.rel.split('/')[0]
							: '_root';
						const files = courses.get(course) ?? new Set<string>();
						if (page.body) files.add(page.body);
						if (page.document) files.add(page.document);
						courses.set(course, files);
					}
					for (const [course, files] of courses) {
						if (!files.size) continue;
						const id = `course-${edition}-${digest(course).slice(0, 16)}`;
						if (!wanted(id)) continue;
						const entries = [...files].sort();
						add(id, digest(JSON.stringify([edition, course, entries])), entries, true);
					}
				}
			} catch {
				if (options.restore) add(`global-${edition}`, digest('missing-current-global'), []);
			}
		}
		if (wanted(`files-global-${edition}`) || wantedCourses(`course-files-${edition}-`)) {
			try {
				const { selector, records } = fileSelection(
					cache,
					edition,
					(course) =>
						wanted(`files-global-${edition}`) ||
						wanted(`course-files-${edition}-${digest(course).slice(0, 16)}`)
				);
				const files = [selector, ...records.map(({ file }) => file)];
				if (wanted(`files-global-${edition}`))
					add(`files-global-${edition}`, fileGlobalInputs(cache, files), files);
				for (const { file, record } of records)
					if (wanted(`course-files-${edition}-${digest(record.course).slice(0, 16)}`))
						add(
							`course-files-${edition}-${digest(record.course).slice(0, 16)}`,
							fileCourseInputs(cache, file, record, edition),
							[file, ...courseHistory(record).map((entry) => entry.path)],
							true
						);
			} catch {
				if (options.restore)
					add(`files-global-${edition}`, digest('missing-current-course-files'), []);
			}
		}
		if (wanted(`search-${edition}`)) {
			try {
				const name = `search-current-${edition}.json`;
				const files = readJson(cache, name);
				if (
					!Array.isArray(files) ||
					!files.length ||
					!files.every((file) => ownedFile(`search-${edition}`, file) && file !== name)
				)
					throw new Error('Invalid search selection');
				const manifests = files.filter((file: string) =>
					new RegExp(`^search/${edition}/[a-f0-9]{64}/manifest\\.json$`).test(file)
				);
				if (manifests.length !== 1) throw new Error('Incomplete search selection');
				const manifest = readJson(cache, manifests[0]);
				if (
					manifest.version !== 1 ||
					manifest.edition !== edition ||
					!sha.test(manifest.key) ||
					!Array.isArray(manifest.files)
				)
					throw new Error('Invalid search manifest');
				const base = `search/${edition}/${manifest.key}`;
				const expected = [
					`${base}/manifest.json`,
					...manifest.files.map((entry: Entry) => `${base}/files/${entry.path}`)
				];
				if (!sameFiles(files, expected)) throw new Error('Incomplete search selection');
				add(`search-${edition}`, manifest.key, [name, ...files]);
			} catch {
				if (options.restore) add(`search-${edition}`, digest('missing-current-search'), []);
			}
		}
	}
	if (wanted('application')) {
		let applicationIdentity: string | undefined;
		try {
			const { applicationCacheIdentity } = await import('./application-cache');
			applicationIdentity = applicationCacheIdentity(site).identity;
		} catch {
			/* Older sites or incomplete dependencies cannot select an exact app artifact. */
		}
		try {
			const pointer = readJson(cache, 'application-current.json');
			if (pointer.schema !== 1 || !sha.test(pointer.identity) || !Array.isArray(pointer.files))
				throw new Error('Invalid application pointer');
			const manifestName = `application/${pointer.identity}/manifest.json`;
			const manifest = readJson(cache, manifestName);
			if (
				manifest.schema !== 1 ||
				manifest.identity !== pointer.identity ||
				!Array.isArray(manifest.files)
			)
				throw new Error('Invalid application manifest');
			const expected = [
				manifestName,
				...manifest.files.map((entry: Entry) => `application/${pointer.identity}/kit/${entry.path}`)
			];
			if (!sameFiles(pointer.files, expected)) throw new Error('Incomplete application selection');
			if (!options.restore && applicationIdentity && pointer.identity !== applicationIdentity)
				throw new Error('Stale application artifact');
			add(
				'application',
				options.restore ? (applicationIdentity ?? pointer.identity) : pointer.identity,
				['application-current.json', ...pointer.files],
				true
			);
		} catch {
			if (options.restore)
				add(
					'application',
					applicationIdentity ?? digest('missing-current-application'),
					[],
					!!applicationIdentity
				);
		}
	}
	return {
		runtime,
		namespace,
		groups: groups
			.filter(
				(group) =>
					(!options.kind || group.kind === options.kind) &&
					(!options.group || group.id === options.group)
			)
			.sort((a, b) => a.id.localeCompare(b.id))
	};
}

export async function planProductCaches(
	site: string,
	options: ProductOptions = {}
): Promise<ProductPlan> {
	const { runtime, namespace, groups } = await selections(path.resolve(site), options);
	return {
		schema: 1,
		namespace,
		runtime,
		groups: groups.map(({ files: _files, kind: _kind, ...group }) => group)
	};
}

function gpgSession(secret: string) {
	if (!secret || /[\r\n]/.test(secret)) throw new Error('Invalid cache secret');
	const directory = mkdtempSync(path.join(tmpdir(), 'wisconsin-product-cache-'));
	const env = { ...process.env, GNUPGHOME: directory };
	const args = [
		'--batch',
		'--yes',
		'--pinentry-mode',
		'loopback',
		'--no-symkey-cache',
		'--passphrase-fd',
		'0'
	];
	return {
		directory,
		run: (extra: string[]) =>
			execFileSync('gpg', [...args, ...extra], {
				env,
				input: secret + '\n',
				stdio: 'pipe',
				timeout: 180_000,
				maxBuffer: 1024 * 1024
			}),
		cleanup() {
			try {
				execFileSync('gpgconf', ['--kill', 'gpg-agent'], { env, stdio: 'pipe', timeout: 10_000 });
			} catch {}
			rmSync(directory, { recursive: true, force: true });
		}
	};
}

function validateEnvelope(value: unknown, group: ProductGroup, runtime: string): Envelope {
	if (!value || typeof value !== 'object') throw new Error('Invalid product envelope');
	const envelope = value as Envelope;
	if (
		envelope.schema !== 1 ||
		envelope.group !== group.id ||
		envelope.runtime !== runtime ||
		(envelope.namespace ?? 'production') !== (group.namespace ?? 'production') ||
		!sha.test(envelope.inputs) ||
		(!group.restoreKeys.length && envelope.inputs !== group.inputs) ||
		!Array.isArray(envelope.files) ||
		!envelope.files.length ||
		envelope.files.length > maximumFiles
	)
		throw new Error('Incompatible product envelope');
	let total = 0;
	const names = new Set<string>();
	for (const entry of envelope.files) {
		if (
			!entry ||
			!ownedFile(group.id, entry.path) ||
			names.has(entry.path) ||
			!Number.isSafeInteger(entry.bytes) ||
			entry.bytes < 0 ||
			entry.bytes > maximumEntry ||
			!sha.test(entry.sha256)
		)
			throw new Error('Invalid product entry');
		if (
			(entry.assetHash === undefined) !== (entry.assetHashVersion === undefined) ||
			(entry.assetHash !== undefined &&
				(!/^[a-f0-9]{32}$/.test(entry.assetHash) || typeof entry.assetHashVersion !== 'string'))
		)
			throw new Error('Invalid product asset hash');
		total += entry.bytes;
		names.add(entry.path);
	}
	if (total > maximumPayload) throw new Error('Product exceeds size limit');
	return envelope;
}

function validateClosure(cache: string, group: Selection, envelope: Envelope) {
	const entries = new Map(envelope.files.map((entry) => [entry.path, entry]));
	const names = [...entries.keys()];
	const edition = groupEdition(group.id);
	if (group.id.startsWith('files-global-')) {
		const { selector, records } = fileSelection(cache, edition);
		if (
			!sameFiles(names, [selector, ...records.map(({ file }) => file)]) ||
			fileGlobalInputs(cache, names) !== envelope.inputs
		)
			throw new Error('Incomplete portable course metadata closure');
		return;
	}
	if (group.id.startsWith('course-files-')) {
		const metadata = names.filter((file) => courseMetadataPath.test(file));
		if (metadata.length !== 1) throw new Error('Incomplete portable course metadata');
		const file = metadata[0];
		const record = courseMetadata(cache, file, edition);
		const history = courseHistory(record);
		if (
			group.id !== `course-files-${edition}-${digest(record.course).slice(0, 16)}` ||
			!sameFiles(names, [file, ...history.map((entry) => entry.path)]) ||
			!sameFiles(names, group.files) ||
			fileCourseInputs(cache, file, record, edition) !== envelope.inputs
		)
			throw new Error('Incomplete course history product closure');
		for (const expected of history) {
			const actual = entries.get(expected.path)!;
			if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
				throw new Error('Course history byte identity mismatch');
		}
		return;
	}
	if (group.kind === 'course') {
		if (!sameFiles(names, group.files)) throw new Error('Incomplete course product closure');
		return;
	}
	if (group.kind === 'global') {
		const indexName = `content-current-${edition}.json`;
		const listName = `content-files-current-${edition}.json`;
		if (!sameFiles(names, [indexName, listName]))
			throw new Error('Incomplete global product closure');
		const candidate = readJson(cache, indexName);
		const index = readContentIndex(cache, edition, candidate.renderer);
		if (!index) throw new Error('Invalid global product index');
		const files = [
			...new Set([
				indexName,
				...Object.values(index.pages).flatMap((page) =>
					[page.body, page.document].filter((file): file is string => !!file)
				)
			])
		];
		if (!sameFiles(readJson(cache, listName), files))
			throw new Error('Invalid global product selection');
		if (
			digest(
				Buffer.concat([
					readFileSync(regular(cache, indexName)),
					readFileSync(regular(cache, listName))
				])
			) !== envelope.inputs
		)
			throw new Error('Global product identity mismatch');
		return;
	}
	const pointerName =
		group.kind === 'application' ? 'application-current.json' : `search-current-${edition}.json`;
	const pointer = readJson(cache, pointerName);
	const selected = group.kind === 'application' ? pointer.files : pointer;
	if (!Array.isArray(selected) || !sameFiles(names, [pointerName, ...selected]))
		throw new Error('Incomplete product pointer closure');
	// Prepared Vite output and Pagefind payloads can themselves contain files
	// named manifest.json. Only the producer's exact root manifest owns closure.
	const manifestName =
		group.kind === 'application'
			? `application/${envelope.inputs}/manifest.json`
			: `search/${edition}/${envelope.inputs}/manifest.json`;
	if (!selected.includes(manifestName)) throw new Error('Incomplete product manifest');
	const manifest = readJson(cache, manifestName);
	let base: string;
	if (group.kind === 'application') {
		if (
			pointer.schema !== 1 ||
			pointer.identity !== envelope.inputs ||
			manifest.schema !== 1 ||
			manifest.identity !== pointer.identity
		)
			throw new Error('Incompatible application product');
		base = `application/${pointer.identity}/kit`;
	} else {
		if (manifest.version !== 1 || manifest.edition !== edition || manifest.key !== envelope.inputs)
			throw new Error('Incompatible search product');
		base = `search/${edition}/${manifest.key}/files`;
	}
	if (
		!Array.isArray(manifest.files) ||
		!sameFiles(selected, [
			manifestName,
			...manifest.files.map((entry: Entry) => `${base}/${entry.path}`)
		])
	)
		throw new Error('Incomplete producer manifest');
	for (const entry of manifest.files) {
		const actual = entries.get(`${base}/${entry.path}`);
		if (
			!actual ||
			!safeRelative(entry.path) ||
			actual.bytes !== entry.bytes ||
			actual.sha256 !== entry.sha256
		)
			throw new Error('Producer byte identity mismatch');
	}
}

async function saveGroup(site: string, group: Selection, runtime: string, secret: string) {
	if (!group.files.length) return false;
	const cache = realpathSync(path.resolve(site, 'build/generated/cache'));
	if (group.id.startsWith('course-files-')) {
		const required = group.files.filter((file) => historyCachePath.test(file));
		if (required.length) {
			const current = readJson(cache, 'history-current.json');
			if (
				!Array.isArray(current) ||
				!current.every((file) => typeof file === 'string' && historyCachePath.test(file)) ||
				!required.every((file) => current.includes(file))
			)
				throw new Error('Course history is not selected by the current full build');
		}
	}
	const entries = group.files.map((file) => {
		const source = regular(cache, file);
		if (statSync(source).size > maximumEntry) throw new Error('Oversized product file');
		const bytes = readFileSync(source);
		const hash = digest(bytes);
		const asset = captureAssetHashes(site, source);
		if (asset.sha256 !== hash || asset.size !== bytes.length)
			throw new Error('Product changed while hashing');
		if (/^content\//.test(file) && path.basename(file, '.json') !== hash)
			throw new Error('Content object hash mismatch');
		return {
			path: file,
			bytes: bytes.length,
			sha256: hash,
			assetHash: asset.hash,
			assetHashVersion: assetHashAlgorithmVersion
		};
	});
	const envelope = validateEnvelope(
		{
			schema: 1,
			runtime,
			group: group.id,
			namespace: group.namespace,
			inputs: group.inputs,
			files: entries
		},
		group,
		runtime
	);
	validateClosure(cache, group, envelope);
	const metadata = Buffer.from(JSON.stringify(envelope));
	if (metadata.length > maximumManifest) throw new Error('Product manifest exceeds limit');
	const length = Buffer.alloc(4);
	length.writeUInt32BE(metadata.length);
	const session = gpgSession(secret);
	try {
		const packed = path.join(session.directory, 'product.gz');
		async function* chunks() {
			yield magic;
			yield length;
			yield metadata;
			for (const entry of entries) {
				const bytes = readFileSync(regular(cache, entry.path));
				if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256)
					throw new Error('Product changed during save');
				yield bytes;
			}
		}
		await pipeline(
			Readable.from(chunks()),
			createGzip({ level: 6 }),
			createWriteStream(packed, { mode: 0o600 })
		);
		const encrypted = path.join(session.directory, 'product.gpg');
		session.run([
			'--symmetric',
			'--cipher-algo',
			'AES256',
			'--compress-algo',
			'none',
			'--force-mdc',
			'--output',
			encrypted,
			packed
		]);
		directoryParents(path.dirname(group.archive), path.resolve(site));
		mkdirSync(path.dirname(group.archive), { recursive: true });
		const temporary = group.archive + `.tmp-${process.pid}`;
		try {
			copyFileSync(encrypted, temporary);
			renameSync(temporary, group.archive);
		} finally {
			rmSync(temporary, { force: true });
		}
		return true;
	} finally {
		session.cleanup();
	}
}

function readExactly(fd: number, size: number) {
	const bytes = Buffer.alloc(size);
	let offset = 0;
	while (offset < size) {
		const read = readSync(fd, bytes, offset, size - offset, null);
		if (!read) throw new Error('Truncated product payload');
		offset += read;
	}
	return bytes;
}

/** Validate the complete archive before any maintained cache mutation. */
async function unpack(packed: string, staged: string, group: ProductGroup, runtime: string) {
	const decoded = path.join(staged, 'payload');
	let bytes = 0;
	await pipeline(
		createReadStream(packed),
		createGunzip(),
		new Transform({
			transform(chunk, _encoding, done) {
				bytes += chunk.length;
				done(
					bytes > maximumPayload + maximumManifest + magic.length + 4
						? new Error('Oversized product payload')
						: null,
					chunk
				);
			}
		}),
		createWriteStream(decoded, { mode: 0o600 })
	);
	const fd = openSync(decoded, 'r');
	try {
		if (!readExactly(fd, magic.length).equals(magic)) throw new Error('Invalid product header');
		const length = readExactly(fd, 4).readUInt32BE();
		if (length > maximumManifest) throw new Error('Oversized product manifest');
		const envelope = validateEnvelope(
			JSON.parse(readExactly(fd, length).toString()),
			group,
			runtime
		);
		for (const entry of envelope.files) {
			const file = path.join(staged, 'files', entry.path);
			mkdirSync(path.dirname(file), { recursive: true });
			const target = openSync(file, 'wx', 0o600);
			const hash = createHash('sha256');
			try {
				let remaining = entry.bytes;
				while (remaining) {
					const chunk = readExactly(fd, Math.min(remaining, 1024 * 1024));
					hash.update(chunk);
					let written = 0;
					while (written < chunk.length)
						written += writeSync(target, chunk, written, chunk.length - written);
					remaining -= chunk.length;
				}
			} finally {
				closeSync(target);
			}
			if (hash.digest('hex') !== entry.sha256) throw new Error('Product hash mismatch');
			if (
				entry.assetHashVersion === assetHashAlgorithmVersion &&
				wranglerAssetHash(readFileSync(file), entry.path) !== entry.assetHash
			)
				throw new Error('Product asset hash mismatch');
			if (entry.path.startsWith('content/') && path.basename(entry.path, '.json') !== entry.sha256)
				throw new Error('Content address mismatch');
		}
		if (readSync(fd, Buffer.alloc(1), 0, 1, null)) throw new Error('Trailing product payload');
		return envelope;
	} finally {
		closeSync(fd);
	}
}

/** Publish validated objects without clobbering concurrent restores; roll back only current pointers. */
export function promoteProductFiles(cache: string, staged: string, envelope: Envelope) {
	directoryParents(cache, path.resolve(cache, '../../..'));
	mkdirSync(cache, { recursive: true });
	if (realpathSync(cache) !== cache) throw new Error('Nonregular cache root');
	for (const entry of envelope.files) {
		const target = path.join(cache, entry.path);
		for (
			let parent = path.dirname(target);
			parent.startsWith(cache);
			parent = path.dirname(parent)
		) {
			if (
				existsSync(parent) &&
				(!lstatSync(parent).isDirectory() || realpathSync(parent) !== parent)
			)
				throw new Error('Unsafe cache directory');
			if (parent === cache) break;
		}
		if (lstatSync(target, { throwIfNoEntry: false })) {
			regular(cache, entry.path);
			if (!mutable(entry.path) && digest(readFileSync(target)) !== entry.sha256)
				throw new Error('Conflicting immutable cache object');
		}
	}
	const transaction = mkdtempSync(path.join(path.dirname(cache), '.product-restore-'));
	const changed: { target: string; backup?: string }[] = [];
	let keepBackup = false;
	try {
		// Objects precede authoritative current pointers.
		for (const entry of [...envelope.files].sort(
			(a, b) => Number(mutable(a.path)) - Number(mutable(b.path))
		)) {
			const target = path.join(cache, entry.path);
			if (!mutable(entry.path)) {
				const verifyExisting = () => {
					if (digest(readFileSync(regular(cache, entry.path))) !== entry.sha256)
						throw new Error('Conflicting immutable cache object');
				};
				if (existsSync(target)) {
					verifyExisting();
					continue;
				}
				mkdirSync(path.dirname(target), { recursive: true });
				const temporary = target + `.product-tmp-${process.pid}`;
				try {
					copyFileSync(path.join(staged, 'files', entry.path), temporary);
					try {
						// A same-directory hardlink atomically publishes complete bytes and refuses
						// to replace a winner from another restore process.
						linkSync(temporary, target);
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
						verifyExisting();
					}
				} finally {
					rmSync(temporary, { force: true });
				}
				// Other successful groups may already reference this object. It remains
				// safe and reusable even if a later file in this restore fails.
				continue;
			}
			const backup = existsSync(target)
				? path.join(transaction, String(changed.length))
				: undefined;
			if (backup) copyFileSync(target, backup);
			mkdirSync(path.dirname(target), { recursive: true });
			const temporary = target + `.product-tmp-${process.pid}`;
			try {
				copyFileSync(path.join(staged, 'files', entry.path), temporary);
				renameSync(temporary, target);
			} finally {
				rmSync(temporary, { force: true });
			}
			changed.push({ target, backup });
		}
	} catch (failure) {
		const errors: unknown[] = [];
		for (const { target, backup } of changed.reverse()) {
			try {
				if (backup) renameSync(backup, target);
				else rmSync(target, { force: true });
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length) {
			keepBackup = true;
			throw new AggregateError(
				[failure, ...errors],
				'Product rollback incomplete; backup retained'
			);
		}
		throw failure;
	} finally {
		if (!keepBackup) rmSync(transaction, { recursive: true, force: true });
	}
}

async function restoreGroup(site: string, group: Selection, runtime: string, secret: string) {
	if (!existsSync(group.archive)) return false;
	if (
		!lstatSync(group.archive).isFile() ||
		realpathSync(group.archive) !== group.archive ||
		statSync(group.archive).size > maximumPayload
	)
		throw new Error('Invalid encrypted product archive');
	const session = gpgSession(secret);
	try {
		const packed = path.join(session.directory, 'product.gz');
		const status = path.join(session.directory, 'status');
		session.run(['--status-file', status, '--output', packed, '--decrypt', group.archive]);
		if (!readFileSync(status, 'utf8').split('\n').includes('[GNUPG:] GOODMDC'))
			throw new Error('Unauthenticated product archive');
		const staged = path.join(session.directory, 'unpacked');
		mkdirSync(staged);
		const envelope = await unpack(packed, staged, group, runtime);
		validateClosure(path.join(staged, 'files'), group, envelope);
		promoteProductFiles(path.resolve(site, 'build/generated/cache'), staged, envelope);
		for (const entry of envelope.files)
			if (entry.assetHashVersion === assetHashAlgorithmVersion && entry.assetHash)
				rememberVerifiedAsset(site, path.resolve(site, 'build/generated/cache', entry.path), {
					hash: entry.assetHash,
					sha256: entry.sha256,
					size: entry.bytes
				});
		return true;
	} finally {
		session.cleanup();
	}
}

export async function transferProductCaches(
	site: string,
	mode: 'save' | 'restore',
	secret: string | undefined,
	options: ProductOptions = {}
) {
	const { runtime, namespace, groups } = await selections(path.resolve(site), {
		...options,
		restore: mode === 'restore'
	});
	const results: { id: string; ready: boolean; reason?: 'missing-secret' | 'miss' | 'invalid' }[] =
		[];
	const replanCourses = mode === 'restore' && !options.group && !options.kind;
	const transfer = async (group: Selection) => {
		if (!secret) {
			results.push({ id: group.id, ready: false, reason: 'missing-secret' });
			return;
		}
		try {
			const ready =
				mode === 'save'
					? await saveGroup(site, group, runtime, secret)
					: await restoreGroup(site, group, runtime, secret);
			results.push({ id: group.id, ready, ...(!ready ? { reason: 'miss' as const } : {}) });
		} catch {
			results.push({ id: group.id, ready: false, reason: 'invalid' });
		}
	};
	for (const group of groups) {
		if (!replanCourses || group.kind !== 'course') await transfer(group);
	}
	if (replanCourses) {
		// A fresh runner learns exact immutable course keys from the authenticated
		// global indexes. Recompute after their restore, including any changed index.
		const current = await selections(path.resolve(site), {
			...options,
			restore: true,
			kind: 'course'
		});
		for (const group of current.groups) await transfer(group);
	}
	if (results.some((result) => result.ready)) {
		try {
			flushAssetHashCache(site);
		} catch {
			/* Hash inventory is optional local acceleration. */
		}
	}
	return { schema: 1 as const, namespace, runtime, results };
}
