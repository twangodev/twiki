import {
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
import { publicAssetManifest } from './public-assets';

function directory(file: string) {
	if (!lstatSync(file).isDirectory()) throw new Error(`Expected build directory: ${file}`);
}

function contained(root: string, file: string) {
	const relative = path.relative(root, path.resolve(root, file));
	if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative))
		throw new Error(`Build artifact escapes its snapshot: ${file}`);
	return path.resolve(root, file);
}

function rejectSymlinks(root: string) {
	for (const entry of readdirSync(root, { recursive: true, withFileTypes: true }))
		if (entry.isSymbolicLink())
			throw new Error(
				`Public artifact cannot be a symlink: ${path.join(entry.parentPath, entry.name)}`
			);
}

/** Assemble completed isolated editions; only successful promotion changes canonical output. */
export function assembleBuilds(canonicalSite: string, publicSite: string, fullSite: string) {
	const sites = [canonicalSite, publicSite, fullSite].map((site) => realpathSync(site));
	if (new Set(sites).size !== sites.length)
		throw new Error('Build editions must have separate roots');
	const publicOutput = path.join(publicSite, 'build/.svelte-kit/cloudflare');
	const fullOutput = path.join(fullSite, 'build/.svelte-kit/cloudflare');
	const publicGenerated = path.join(publicSite, 'build/generated');
	const fullGenerated = path.join(fullSite, 'build/generated');
	const trees = ['build/.svelte-kit', 'build/generated', 'src/lib/generated', 'static'];
	for (const tree of trees) directory(path.join(fullSite, tree));
	directory(publicOutput);
	directory(fullOutput);
	rejectSymlinks(publicOutput);
	const pages: Record<string, string> = JSON.parse(
		readFileSync(path.join(publicGenerated, 'public-routes.json'), 'utf8')
	);
	const content: { htmlAssets: string[] } = JSON.parse(
		readFileSync(path.join(publicGenerated, 'content-manifest.json'), 'utf8')
	);
	const entries: { course: string; file: string }[] = JSON.parse(
		readFileSync(path.join(publicSite, 'src/lib/generated/file-entries.json'), 'utf8')
	);
	for (const asset of content.htmlAssets) {
		pages[`/${asset}`] = `${asset}.html`;
		pages[`/${asset}.html`] = `${asset}.html`;
	}
	for (const file of Object.values(pages)) {
		const target = contained(publicOutput, file);
		if (!lstatSync(target).isFile()) throw new Error(`Public page is missing: ${file}`);
	}
	const publicAssets = publicAssetManifest(publicOutput, pages, entries);
	for (const target of new Set(Object.values(publicAssets))) {
		const relative = decodeURIComponent(target.slice('/_published'.length));
		const file = contained(publicOutput, relative.replace(/^\//, '') || 'index.html');
		if (
			![file, `${file}.html`].some(
				(candidate) => existsSync(candidate) && lstatSync(candidate).isFile()
			)
		)
			throw new Error(`Public asset target is missing: ${target}`);
	}

	const published = path.join(fullOutput, '_published');
	const transaction = mkdtempSync(path.join(canonicalSite, 'build/.assembly-'));
	const promoted: {
		source: string;
		target: string;
		backup: string;
		replaced: boolean;
		installed: boolean;
	}[] = [];
	let movedPublic = false;
	try {
		rmSync(published, { recursive: true, force: true });
		renameSync(publicOutput, published);
		movedPublic = true;
		for (const name of ['public-routes.json', 'public-assets', 'public-files', 'public-static']) {
			const source = path.join(publicGenerated, name);
			if (!existsSync(source)) continue;
			const target = path.join(fullGenerated, name);
			rmSync(target, { recursive: true, force: true });
			renameSync(source, target);
		}
		writeFileSync(path.join(fullGenerated, 'public-assets.json'), JSON.stringify(publicAssets));
		// These local reuse records contain scratch paths and output inode stamps.
		rmSync(path.join(fullGenerated, 'cache/course-files'), { recursive: true, force: true });
		rmSync(path.join(fullGenerated, 'dev-state.json'), { force: true });
		for (const [index, tree] of trees.entries()) {
			const operation = {
				source: path.join(fullSite, tree),
				target: path.join(canonicalSite, tree),
				backup: path.join(transaction, String(index)),
				replaced: false,
				installed: false
			};
			promoted.push(operation);
			mkdirSync(path.dirname(operation.target), { recursive: true });
			if (existsSync(operation.target)) {
				renameSync(operation.target, operation.backup);
				operation.replaced = true;
			}
			renameSync(operation.source, operation.target);
			operation.installed = true;
		}
	} catch (error) {
		const failures: unknown[] = [];
		for (const operation of promoted.reverse()) {
			try {
				if (operation.installed) renameSync(operation.target, operation.source);
				if (operation.replaced) renameSync(operation.backup, operation.target);
			} catch (rollbackError) {
				failures.push(rollbackError);
			}
		}
		if (movedPublic && existsSync(published)) {
			try {
				renameSync(published, publicOutput);
			} catch (rollbackError) {
				failures.push(rollbackError);
			}
		}
		if (failures.length)
			throw new AggregateError(
				[error, ...failures],
				`Assembly rollback failed; backups retained at ${transaction}`
			);
		rmSync(transaction, { recursive: true, force: true });
		throw error;
	}
	// Canonical .wrangler and build/.wrangler are outside the promoted trees.
	rmSync(transaction, { recursive: true, force: true });
	return { publicPages: Object.keys(pages).length, fileRoutes: entries.length, publicAssets };
}
