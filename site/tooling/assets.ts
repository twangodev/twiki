/** Sync assets, emit navigation, and report unresolved content links for prerendering. */

import {
	copyFileSync,
	cpSync,
	existsSync,
	linkSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	unlinkSync
} from 'node:fs';
import path from 'node:path';
import {
	staticDirectory,
	courseFilesDirectory,
	compiledAssetsDirectory
} from './lib/edition-paths.js';
import { pruneOutputs, recordOutput, removeOutput, writeChanged } from './lib/output';
import { writeTextExports } from './lib/text-exports';
import { buildCourseFiles } from './lib/course-files';
import { assetSources } from './lib/asset-sources';
import { addNotebookNavigation } from '../src/lib/notebook-nav';
import type { CourseFile } from '../src/lib/files';
import { runtimeDataAssets, runtimeDataModuleSource } from './lib/runtime-data-modules';
import { getManifest, resetContentCache, loadPage } from '../src/lib/server/content';
import { createContentModel } from '../src/lib/server/content-model';
import type { ContentManifest } from '../src/lib/types';

/** Narrowed sync requires the caller to independently verify untouched outputs. */
export async function prepareAssets(
	changedInputs?: Set<string>,
	development = false,
	compiledManifest?: ContentManifest,
	changedOutputs?: ReadonlySet<string>
) {
	resetContentCache();
	const SITE_DIR = path.resolve(import.meta.dirname, '..');
	const GENERATED = path.join(SITE_DIR, 'build/generated');
	const STATIC_DIR = staticDirectory(SITE_DIR);
	mkdirSync(STATIC_DIR, { recursive: true });
	if (process.env.VITE_PUBLIC_EDITION === 'true') {
		for (const name of ['fonts', 'favicon.ico']) {
			const source = path.join(SITE_DIR, 'static', name);
			if (existsSync(source)) {
				const destination = path.join(STATIC_DIR, name);
				cpSync(source, destination, { recursive: true });
				if (development) {
					const observe = (file: string) => {
						const info = lstatSync(file, { bigint: true });
						if (info.isDirectory())
							for (const child of readdirSync(file)) observe(path.join(file, child));
						else recordOutput(file, info);
					};
					observe(destination);
				}
			}
		}
	}

	if (!existsSync(path.join(GENERATED, 'content-manifest.json'))) {
		throw new Error('Content must be compiled before preparing assets');
	}

	const manifest = compiledManifest ?? getManifest();
	const { navTree, contentEntries, displayRoute, pageSlugForRoute } = createContentModel(manifest);
	const courseOutputs = await buildCourseFiles(
		SITE_DIR,
		new Set(Object.keys(manifest.pages)),
		changedInputs,
		development,
		changedOutputs !== undefined
	);
	if (process.env.VITE_PUBLIC_EDITION === 'true') {
		const entries = JSON.parse(
			readFileSync(path.join(SITE_DIR, 'src/lib/generated/file-entries.json'), 'utf8')
		) as { course: string; file: string }[];
		manifest.fileCourses = entries
			.filter((entry) => entry.file === '')
			.map((entry) => entry.course);
		for (const course of manifest.fileCourses) {
			if (!manifest.folders.includes(course)) manifest.folders.push(course);
			if (!manifest.tree.children.some((node) => node.slug === course))
				manifest.tree.children.push({
					name: course,
					slug: course,
					title: course,
					children: [],
					pages: []
				});
		}
		writeChanged(path.join(GENERATED, 'content-manifest.json'), JSON.stringify(manifest));
	}
	const WARN_BYTES = 20 * 1024 * 1024;
	const FAIL_BYTES = 25 * 1024 * 1024;

	// ---------------------------------------------------------------------------
	// 1. Asset sync into static/
	// ---------------------------------------------------------------------------

	const htmlAssetSet = new Set(manifest.htmlAssets);
	const srcRoot = compiledAssetsDirectory(SITE_DIR);

	/** rel path in build/generated/assets → rel path in static/. */
	function destRel(rel: string): string {
		return htmlAssetSet.has(rel) ? `${rel}.html` : rel;
	}

	let copied = 0;
	let kept = 0;
	let oversize = false;
	const wanted = new Set<string>(Object.values(runtimeDataAssets));

	if (changedOutputs) {
		// Course-file pruning may remove an old raw note blob or replace an index.
		// Mirror those removals before verifying the complete expected output.
		const fileRoot = courseFilesDirectory(SITE_DIR) + path.sep;
		for (const file of changedOutputs) {
			if (!file.startsWith(fileRoot) || existsSync(file)) continue;
			const destination = path.join(STATIC_DIR, '_files', path.relative(fileRoot, file));
			if (existsSync(destination)) {
				unlinkSync(destination);
				removeOutput(destination);
			}
		}
		for (const asset of manifest.assets) wanted.add(destRel(asset));
	}
	const sources = assetSources(
		srcRoot,
		changedOutputs ? [] : manifest.assets,
		courseFilesDirectory(SITE_DIR),
		changedOutputs ? [...courseOutputs].filter((file) => changedOutputs.has(file)) : courseOutputs
	);
	for (const { src, rel: relative } of sources) {
		const rel = relative.split(path.sep).join('/');
		const out = destRel(rel);
		wanted.add(out);
		const dest = path.join(STATIC_DIR, out);
		const srcStat = statSync(src);
		if (srcStat.size > FAIL_BYTES) {
			console.error(
				`FAIL: asset ${rel} is ${(srcStat.size / 1048576).toFixed(1)} MiB (>25 MiB Workers cap)`
			);
			oversize = true;
		} else if (srcStat.size > WARN_BYTES) {
			console.warn(`warn: asset ${rel} is ${(srcStat.size / 1048576).toFixed(1)} MiB (>20 MiB)`);
		}
		const destStat = statSync(dest, { throwIfNoEntry: false });
		if (destStat) {
			if (
				(destStat.dev === srcStat.dev && destStat.ino === srcStat.ino) ||
				(destStat.size === srcStat.size && readFileSync(dest).equals(readFileSync(src)))
			) {
				kept++;
				continue;
			}
			unlinkSync(dest);
			removeOutput(dest);
		}
		mkdirSync(path.dirname(dest), { recursive: true });
		let linked = false;
		try {
			linkSync(src, dest); // hardlink: free, instant
			linked = true;
		} catch {
			copyFileSync(src, dest);
		}
		if (development) {
			if (linked) recordOutput(src);
			recordOutput(dest);
		}
		copied++;
	}
	if (oversize) throw new Error('Assets exceed the deployment size limit');

	for (const file of writeTextExports(
		STATIC_DIR,
		path.join(GENERATED, 'pages'),
		Object.values(manifest.pages),
		wanted,
		development,
		changedOutputs
	))
		wanted.add(file);

	// Prune stale synced files (never touch the hand-placed statics).
	const KEEP = new Set(['.gitignore', 'favicon.ico']);
	const wantedPaths = new Set([...wanted].map((file) => path.join(STATIC_DIR, file)));
	const pruned = changedOutputs
		? 0
		: pruneOutputs(STATIC_DIR, wantedPaths, (file) => {
				const rel = path.relative(STATIC_DIR, file).split(path.sep).join('/');
				return KEEP.has(rel) || rel === 'fonts' || rel === '_og';
			});
	if (changedOutputs) console.log(`assets: ${copied} changed files synced`);
	else {
		console.log(`assets: pruned ${pruned} stale files`);
		console.log(`assets: ${copied} synced, ${kept} up-to-date, ${wanted.size} total`);
	}

	// ---------------------------------------------------------------------------
	// 2. Nav tree module
	// ---------------------------------------------------------------------------

	const navOut = path.join(SITE_DIR, 'src/lib/generated/nav.json');
	mkdirSync(path.dirname(navOut), { recursive: true });
	const navigation = navTree();
	const fileIndexDirectory = path.join(STATIC_DIR, '_files/index');
	for (const name of existsSync(fileIndexDirectory) ? readdirSync(fileIndexDirectory) : []) {
		if (!name.endsWith('.json')) continue;
		const files: CourseFile[] = JSON.parse(
			readFileSync(path.join(STATIC_DIR, '_files/index', name), 'utf8')
		);
		addNotebookNavigation(navigation, name.slice(0, -5), files);
	}
	for (const node of navigation) {
		if (manifest.fileCourses?.includes(node.segment) && !node.children.length)
			node.children.push({
				title: 'Files',
				segment: 'files',
				route: `/${node.segment}/files`,
				children: []
			});
	}
	writeChanged(navOut, JSON.stringify(navigation));
	for (const [input, asset] of Object.entries(runtimeDataAssets)) {
		const data = JSON.parse(readFileSync(path.join(path.dirname(navOut), input), 'utf8'));
		writeChanged(path.join(STATIC_DIR, asset), runtimeDataModuleSource(data));
	}
	console.log(`nav: wrote src/lib/generated/nav.json`);
	console.log(
		`routes: ${contentEntries().length} content + ${Object.keys(manifest.tags).length + 1} tag + 2 xml + /404`
	);

	// These reports are consumed only by the production prerender crawler.
	// Live routes already return their normal 404 responses without scanning every page.
	if (development) return;

	// ---------------------------------------------------------------------------
	// 3. Expected-404 list for the strict prerender crawler
	// ---------------------------------------------------------------------------

	const valid = new Set<string>(['/']);
	for (const route of contentEntries()) if (route !== '') valid.add(`/${route}`);
	valid.add('/tags');
	for (const tag of Object.keys(manifest.tags)) valid.add(`/tags/${tag}`);
	for (const a of manifest.assets) valid.add(`/${a}`);
	// html assets are linkable both extensionless (live URL) and with .html
	for (const h of manifest.htmlAssets) {
		valid.add(`/${h}`);
		valid.add(`/${h}.html`);
	}
	valid.add('/index.xml');
	valid.add('/sitemap.xml');
	valid.add('/404');
	valid.add('/favicon.ico');

	const expected404 = new Set<string>();
	const attrRe = /(?:href|src)="([^"]*)"/g;
	for (const slug of Object.keys(manifest.pages)) {
		const doc = loadPage(slug);
		for (const match of doc.html.matchAll(attrRe)) {
			const raw = match[1];
			if (!raw.startsWith('/') || raw.startsWith('//')) continue; // internal only
			let p = raw.split('#')[0].split('?')[0];
			if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
			try {
				p = decodeURI(p);
			} catch {
				/* keep raw */
			}
			if (p === '') p = '/';
			if (!valid.has(p)) expected404.add(p);
		}
	}

	const sorted = [...expected404].sort();
	writeChanged(path.join(GENERATED, 'expected-404.json'), JSON.stringify(sorted, null, '\t'));
	console.log(
		`expected-404: ${sorted.length} unresolved content link targets reported to the crawler`
	);

	// Missing content anchors are reported without blocking publication.
	const pageIds = new Map<string, Set<string>>();
	const idRe = /id="([^"]*)"/g;
	for (const slug of Object.keys(manifest.pages)) {
		const doc = loadPage(slug);
		const ids = new Set<string>();
		for (const m of doc.html.matchAll(idRe)) ids.add(m[1]);
		pageIds.set(slug, ids);
	}

	const missingAnchor = new Set<string>();
	const anchorRe = /(?:href|src)="((?:\/[^"#]*)?#[^"]+)"/g;
	for (const slug of Object.keys(manifest.pages)) {
		const doc = loadPage(slug);
		for (const m of doc.html.matchAll(anchorRe)) {
			const raw = m[1];
			if (raw.startsWith('//')) continue;
			const hashIdx = raw.indexOf('#');
			let target = raw.slice(0, hashIdx) || `/${displayRoute(slug)}`;
			let id = raw.slice(hashIdx + 1);
			if (id.startsWith('page=')) continue; // PDF page anchors pass raw
			try {
				target = decodeURI(target);
				id = decodeURI(id);
			} catch {
				/* keep raw */
			}
			if (target.length > 1 && target.endsWith('/')) target = target.slice(0, -1);
			// Map the URL path the prerenderer renders (`/` → home, `/dir` → folder
			// index) to the canonical page slug, exactly like the catch-all route.
			const route = target === '/' ? '' : target.slice(1);
			const targetSlug = pageSlugForRoute(route);
			if (!targetSlug) continue; // not a page route (asset/folder-listing/404 elsewhere)
			const ids = pageIds.get(targetSlug);
			if (!ids) continue;
			// The prerenderer keys missing-id errors by the rendered path, not the slug.
			if (!ids.has(id)) missingAnchor.add(`${target}#${id}`);
		}
	}

	const sortedIds = [...missingAnchor].sort();
	writeChanged(
		path.join(GENERATED, 'expected-missing-id.json'),
		JSON.stringify(sortedIds, null, '\t')
	);
	console.log(
		`expected-missing-id: ${sortedIds.length} unresolved content anchors reported to the crawler`
	);
	const { buildSocialImages } = await import('./lib/social-images');
	await buildSocialImages(SITE_DIR, manifest);
}
