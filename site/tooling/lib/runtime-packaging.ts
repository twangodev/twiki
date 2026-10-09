import {
	constants,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import path from 'node:path';
import type { ContentManifest, PageDoc } from '../../src/lib/types';
import { fileRoute } from '../../src/lib/files';
import { createContentModel } from '../../src/lib/server/content-model';
import { captureAssetHashes } from './asset-hash-cache';
import { sha256 } from './deployment-config';
import {
	assetContentType,
	createAssetInventory,
	mergeVerifiedInventories,
	type AssetInventory,
	type DeploymentAsset
} from './deployment-manifest';

export type RuntimeEdition = 'public' | 'full';
export type CapturedEdition = {
	edition: RuntimeEdition;
	metadata: string;
	staticRoot: string;
	routes: string[];
	staticAssets: Record<string, DeploymentAsset>;
	sources: Record<string, string>;
};
const copyOptions = { recursive: true, mode: constants.COPYFILE_FICLONE, preserveTimestamps: true };
const urlPath = (file: string) => '/' + file.split('/').map(encodeURIComponent).join('/');
function ownedFile(root: string, file: string) {
	const absolute = path.resolve(root, file);
	if (
		!absolute.startsWith(path.resolve(root) + path.sep) ||
		!lstatSync(absolute).isFile() ||
		realpathSync(absolute) !== absolute
	)
		throw new Error('Runtime artifact must be an owned regular file');
	return absolute;
}
function files(directory: string): string[] {
	const result: string[] = [];
	function walk(relative: string) {
		for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true })) {
			const file = relative ? `${relative}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(file);
			else {
				ownedFile(directory, file);
				result.push(file);
			}
		}
	}
	walk('');
	return result.sort();
}
function copy(source: string, destination: string) {
	mkdirSync(path.dirname(destination), { recursive: true });
	cpSync(source, destination, copyOptions);
}
function asset(site: string, source: string, filename: string): DeploymentAsset {
	return { ...captureAssetHashes(site, source), contentType: assetContentType(filename) };
}
function staticFiles(root: string) {
	return files(root).filter(
		(file) => !file.startsWith('.') && !['_headers', '_redirects', '_worker.js'].includes(file)
	);
}

/** Capture an edition immediately after its pipeline, before the next edition replaces shared JSON. */
export function captureRuntimeEdition(
	site: string,
	edition: RuntimeEdition,
	metadata: string,
	searchDirectory?: string
): CapturedEdition {
	if (existsSync(metadata)) throw new Error('Runtime metadata staging already exists');
	mkdirSync(metadata, { recursive: true });
	const generated = path.join(site, 'build/generated');
	const manifest: ContentManifest = JSON.parse(
		readFileSync(ownedFile(generated, 'content-manifest.json'), 'utf8')
	);
	copy(ownedFile(generated, 'content-manifest.json'), path.join(metadata, 'manifest.json'));
	for (const slug of Object.keys(manifest.pages)) {
		const name = `pages/${slug}.json`;
		const source = ownedFile(generated, name);
		const page: PageDoc = JSON.parse(readFileSync(source, 'utf8'));
		if (
			page.slug !== slug ||
			page.publication.public !== manifest.pages[slug].publication.public ||
			(edition === 'public' &&
				!page.publication.public &&
				(!page.locked || page.html || page.markdown || page.description))
		)
			throw new Error('Runtime PageDoc publication does not match its edition');
		copy(source, path.join(metadata, name));
	}
	for (const name of ['nav.json', 'file-icons.json'])
		copy(ownedFile(path.join(site, 'src/lib/generated'), name), path.join(metadata, name));
	const staticRoot = path.join(
		site,
		edition === 'public' ? 'build/generated/public-static' : 'static'
	);
	const staticAssets: Record<string, DeploymentAsset> = Object.create(null);
	const sources: Record<string, string> = Object.create(null);
	for (const name of staticFiles(staticRoot)) {
		if (name.startsWith('pagefind/')) continue;
		if (/^(?:_app|_content|_published)(?:\/|$)/.test(name))
			throw new Error('Runtime assets cannot replace application/internal namespaces');
		sources[name] = ownedFile(staticRoot, name);
		staticAssets[name] = asset(site, sources[name], urlPath(name));
	}
	if (searchDirectory)
		for (const name of files(path.join(searchDirectory, 'pagefind'))) {
			const target = `pagefind/${name}`;
			sources[target] = ownedFile(path.join(searchDirectory, 'pagefind'), name);
			staticAssets[target] = asset(site, sources[target], urlPath(target));
		}
	const model = createContentModel(manifest);
	const routes = new Set([
		'/',
		'/tags',
		'/index.xml',
		'/sitemap.xml',
		'/graph.json',
		'/robots.txt',
		'/404',
		...model.contentEntries().map((route) => (route ? '/' + route : '/')),
		...Object.keys(manifest.tags).map((tag) => `/tags/${tag}`)
	]);
	const catalogs = path.join(staticRoot, '_files/index');
	if (existsSync(catalogs))
		for (const name of readdirSync(catalogs)) {
			if (!name.endsWith('.json')) continue;
			const course = name.slice(0, -5);
			const entries = JSON.parse(readFileSync(ownedFile(catalogs, name), 'utf8')) as {
				path: string;
			}[];
			routes.add(fileRoute(course, ''));
			for (const entry of entries) {
				const segments = entry.path.split('/');
				for (let i = 1; i <= segments.length; i++)
					routes.add(fileRoute(course, segments.slice(0, i).join('/')));
			}
		}
	const aliases: Record<string, string> = Object.create(null);
	for (const name of Object.keys(staticAssets))
		aliases[urlPath(name)] = edition === 'public' ? `/_published${urlPath(name)}` : urlPath(name);
	for (const name of manifest.htmlAssets) {
		const target =
			edition === 'public' ? `/_published${urlPath(`${name}.html`)}` : urlPath(`${name}.html`);
		if (!staticAssets[`${name}.html`]) throw new Error('Runtime HTML asset is missing');
		aliases[urlPath(name)] = aliases[urlPath(`${name}.html`)] = target;
	}
	const navHash = captureAssetHashes(site, path.join(metadata, 'nav.json')).sha256;
	const iconHash = captureAssetHashes(site, path.join(metadata, 'file-icons.json')).sha256;
	const manifestHash = captureAssetHashes(site, path.join(metadata, 'manifest.json')).sha256;
	const htmlKeys: Record<string, string> = Object.create(null);
	for (const route of routes) {
		const slug = model.pageSlugForRoute(route === '/' ? '' : route.slice(1));
		htmlKeys[route] = slug
			? sha256(
					JSON.stringify([
						captureAssetHashes(site, path.join(metadata, `pages/${slug}.json`)).sha256,
						navHash,
						iconHash
					])
				)
			: sha256(JSON.stringify([manifestHash, navHash, iconHash, route]));
	}
	writeFileSync(
		path.join(metadata, 'routing.json'),
		JSON.stringify({ schemaVersion: 1, routes: [...routes].sort(), assets: aliases, htmlKeys })
	);
	return { edition, metadata, staticRoot, routes: [...routes].sort(), staticAssets, sources };
}

export function packageRuntime(
	site: string,
	output: string,
	applicationVersion: string,
	editions: CapturedEdition[],
	appInventory: AssetInventory
) {
	if (
		!/^[a-f0-9]{64}$/.test(applicationVersion) ||
		editions.length !== 2 ||
		new Set(editions.map((value) => value.edition)).size !== 2
	)
		throw new Error('Runtime package requires one verified public and full edition');
	const pieces = [{ owner: 'application', inventory: appInventory }];
	const ownership: Record<string, { owner: string; sha256: string; size: number }> =
		Object.create(null);
	for (const [name, value] of Object.entries(appInventory.assets))
		ownership[name] = { owner: 'application', sha256: value.sha256, size: value.size };
	const snapshots = { public: '', full: '' };
	for (const edition of editions) {
		if (edition.edition === 'public') {
			const routeFile = path.join(edition.metadata, 'routing.json');
			const routing = JSON.parse(readFileSync(routeFile, 'utf8'));
			for (const [name, value] of Object.entries(appInventory.assets)) {
				if (!name.startsWith('/_app/') && !name.startsWith('/fonts/') && name !== '/favicon.png')
					continue;
				const key = urlPath(name.slice(1));
				const inherited = edition.staticAssets[name.slice(1)];
				if (inherited && (inherited.sha256 !== value.sha256 || inherited.size !== value.size))
					throw new Error('Shared application asset conflicts with public static output');
				routing.assets[key] = key;
			}
			writeFileSync(routeFile, JSON.stringify(routing));
		}
		const metadataAssets: Record<string, DeploymentAsset> = Object.create(null);
		for (const name of files(edition.metadata))
			metadataAssets[name] = asset(site, ownedFile(edition.metadata, name), urlPath(name));
		const snapshot = sha256(
			JSON.stringify([
				edition.edition,
				Object.entries(metadataAssets).map(([name, value]) => [name, value.sha256, value.size]),
				Object.entries(edition.staticAssets).map(([name, value]) => [
					name,
					value.sha256,
					value.size
				])
			])
		);
		snapshots[edition.edition] = snapshot;
		const assets: Record<string, DeploymentAsset> = Object.create(null);
		for (const [name, value] of Object.entries(metadataAssets)) {
			const physical = `/_content/${edition.edition}/${snapshot}/${name}`;
			copy(ownedFile(edition.metadata, name), path.join(output, physical));
			assets[physical] = value;
		}
		for (const [name, value] of Object.entries(edition.staticAssets)) {
			const physical = edition.edition === 'public' ? `/_published/${name}` : `/${name}`;
			const source = edition.sources[name];
			if (!source || !lstatSync(source).isFile() || realpathSync(source) !== source)
				throw new Error('Runtime source changed before packaging');
			copy(source, path.join(output, physical));
			assets[physical] = value;
		}
		const product = createAssetInventory(assets, snapshot);
		pieces.push({ owner: edition.edition, inventory: product });
		for (const [name, value] of Object.entries(assets))
			ownership[name] = { owner: edition.edition, sha256: value.sha256, size: value.size };
	}
	const descriptor = Buffer.from(
		JSON.stringify({ schemaVersion: 1, applicationVersion, snapshots })
	);
	const provenance = sha256(descriptor);
	const currentPath = path.join(output, '_content/current.json');
	mkdirSync(path.dirname(currentPath), { recursive: true });
	writeFileSync(currentPath, descriptor); // Immutable snapshots are complete before the current pointer appears.
	const control = createAssetInventory(
		{ '/_content/current.json': asset(site, currentPath, '/_content/current.json') },
		provenance
	);
	pieces.push({ owner: 'current', inventory: control });
	ownership['/_content/current.json'] = {
		owner: 'current',
		sha256: control.assets['/_content/current.json'].sha256,
		size: descriptor.length
	};
	const inventory = mergeVerifiedInventories({
		pieces,
		expectedProducts: Object.fromEntries(
			pieces.map((piece) => [
				piece.owner,
				{ provenance: piece.inventory.provenance, digest: piece.inventory.digest }
			])
		),
		ownership,
		provenance,
		controlFiles: appInventory.controlFiles
	});
	return {
		snapshots,
		provenance,
		inventory,
		publicRoutes: editions.find((value) => value.edition === 'public')!.routes.length
	};
}

/** Install a complete product after its application, both editions and descriptor have succeeded. */
export function promoteRuntimeProduct(site: string, staged: string) {
	const target = path.join(site, 'build/.svelte-kit');
	const transaction = mkdtempSync(path.join(site, 'build/.runtime-promotion-'));
	const previous = path.join(transaction, 'previous');
	let moved = false,
		preserve = false;
	try {
		if (existsSync(target)) {
			renameSync(target, previous);
			moved = true;
		}
		try {
			renameSync(staged, target);
		} catch (error) {
			if (moved)
				try {
					renameSync(previous, target);
				} catch (rollback) {
					preserve = true;
					throw new AggregateError(
						[error, rollback],
						'Previous runtime product preserved for recovery'
					);
				}
			throw error;
		}
	} finally {
		if (!preserve) rmSync(transaction, { recursive: true, force: true });
	}
}
