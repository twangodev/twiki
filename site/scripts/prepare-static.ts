/** Sync assets, emit navigation, and report unresolved content links for prerendering. */

import {
	copyFileSync,
	existsSync,
	linkSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import path from 'node:path';
import { buildCourseFiles } from './lib/course-files';
import {
	contentEntries,
	displayRoute,
	getManifest,
	navTree,
	pageSlugForRoute
} from '../src/lib/server/content';

const SITE_DIR = path.resolve(import.meta.dir, '..');
const GENERATED = path.join(SITE_DIR, '.generated');
const STATIC_DIR = path.join(SITE_DIR, 'static');
if (!existsSync(path.join(GENERATED, 'public-assets.json'))) {
	mkdirSync(GENERATED, { recursive: true });
	writeFileSync(path.join(GENERATED, 'public-assets.json'), '{}');
}

if (!existsSync(path.join(GENERATED, 'content-manifest.json'))) {
	console.error('prepare-static: .generated/content-manifest.json missing.');
	console.error('Run `bun run build:content` first.');
	process.exit(1);
}

const manifest = getManifest();
await buildCourseFiles(SITE_DIR, new Set(Object.keys(manifest.pages)));
if (process.env.VITE_PUBLIC_EDITION === 'true') {
	const entries = JSON.parse(
		readFileSync(path.join(SITE_DIR, 'src/lib/generated/file-entries.json'), 'utf8')
	) as { course: string; file: string }[];
	manifest.fileCourses = entries.filter((entry) => entry.file === '').map((entry) => entry.course);
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
	writeFileSync(path.join(GENERATED, 'content-manifest.json'), JSON.stringify(manifest));
}
const WARN_BYTES = 20 * 1024 * 1024;
const FAIL_BYTES = 25 * 1024 * 1024;

// ---------------------------------------------------------------------------
// 1. Asset sync into static/
// ---------------------------------------------------------------------------

const htmlAssetSet = new Set(manifest.htmlAssets);
const srcRoot = path.join(GENERATED, 'assets');

/** rel path in .generated/assets → rel path in static/. */
function destRel(rel: string): string {
	return htmlAssetSet.has(rel) ? `${rel}.html` : rel;
}

function* walk(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(p);
		else yield p;
	}
}

let copied = 0;
let kept = 0;
let oversize = false;
const wanted = new Set<string>();

for (const src of walk(srcRoot)) {
	const rel = path.relative(srcRoot, src).split(path.sep).join('/');
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
	if (existsSync(dest)) {
		const destStat = statSync(dest);
		if (
			destStat.ino === srcStat.ino ||
			(destStat.size === srcStat.size && destStat.mtimeMs >= srcStat.mtimeMs)
		) {
			kept++;
			continue;
		}
		unlinkSync(dest);
	}
	mkdirSync(path.dirname(dest), { recursive: true });
	try {
		linkSync(src, dest); // hardlink: free, instant
	} catch {
		copyFileSync(src, dest);
	}
	copied++;
}
if (oversize) process.exit(1);

// Prune stale synced files (never touch the hand-placed statics).
const KEEP = new Set(['.gitignore', 'favicon.png']);
for (const file of walk(STATIC_DIR)) {
	const rel = path.relative(STATIC_DIR, file).split(path.sep).join('/');
	if (KEEP.has(rel) || rel.startsWith('fonts/')) continue;
	if (!wanted.has(rel)) {
		unlinkSync(file);
		console.log(`pruned stale static file: ${rel}`);
	}
}
// Remove now-empty directories.
function pruneEmptyDirs(dir: string): boolean {
	let empty = true;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (pruneEmptyDirs(p)) rmSync(p, { recursive: true });
			else empty = false;
		} else empty = false;
	}
	return empty;
}
pruneEmptyDirs(STATIC_DIR);

console.log(`assets: ${copied} synced, ${kept} up-to-date, ${wanted.size} total`);

// ---------------------------------------------------------------------------
// 2. Nav tree module
// ---------------------------------------------------------------------------

const navOut = path.join(SITE_DIR, 'src/lib/generated/nav.json');
mkdirSync(path.dirname(navOut), { recursive: true });
const navigation = navTree();
for (const node of navigation) {
	if (manifest.fileCourses?.includes(node.segment) && !node.children.length)
		node.children.push({
			title: 'Files',
			segment: 'files',
			route: `/${node.segment}/files`,
			children: []
		});
}
writeFileSync(navOut, JSON.stringify(navigation));
console.log(`nav: wrote src/lib/generated/nav.json`);

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
valid.add('/favicon.png');

const expected404 = new Set<string>();
const attrRe = /(?:href|src)="([^"]*)"/g;
for (const slug of Object.keys(manifest.pages)) {
	const doc = JSON.parse(readFileSync(path.join(GENERATED, 'pages', `${slug}.json`), 'utf-8')) as {
		html: string;
	};
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
writeFileSync(path.join(GENERATED, 'expected-404.json'), JSON.stringify(sorted, null, '\t'));
console.log(
	`expected-404: ${sorted.length} unresolved content link targets reported to the crawler`
);

// Missing content anchors are reported without blocking publication.
const pageIds = new Map<string, Set<string>>();
const idRe = /id="([^"]*)"/g;
for (const slug of Object.keys(manifest.pages)) {
	const doc = JSON.parse(readFileSync(path.join(GENERATED, 'pages', `${slug}.json`), 'utf-8')) as {
		html: string;
	};
	const ids = new Set<string>();
	for (const m of doc.html.matchAll(idRe)) ids.add(m[1]);
	pageIds.set(slug, ids);
}

const missingAnchor = new Set<string>();
const anchorRe = /(?:href|src)="(\/[^"#]*#[^"]+)"/g;
for (const slug of Object.keys(manifest.pages)) {
	const doc = JSON.parse(readFileSync(path.join(GENERATED, 'pages', `${slug}.json`), 'utf-8')) as {
		html: string;
	};
	for (const m of doc.html.matchAll(anchorRe)) {
		const raw = m[1];
		if (raw.startsWith('//')) continue;
		const hashIdx = raw.indexOf('#');
		let target = raw.slice(0, hashIdx);
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
writeFileSync(
	path.join(GENERATED, 'expected-missing-id.json'),
	JSON.stringify(sortedIds, null, '\t')
);
console.log(
	`expected-missing-id: ${sortedIds.length} unresolved content anchors reported to the crawler`
);
console.log(
	`routes: ${contentEntries().length} content + ${Object.keys(manifest.tags).length + 1} tag + 2 xml + /404`
);
