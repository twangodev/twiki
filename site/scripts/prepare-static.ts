/**
 * Prepares build inputs from `.generated` (run after `build:content`, before
 * `vite dev`/`vite build`). Three jobs:
 *
 * 1. Sync `.generated/assets/**` into `static/` (hardlinks when possible) so
 *    SvelteKit serves/copies them like any static asset — the simplest
 *    mechanism that works identically in dev, prerender crawling, and the
 *    Workers deploy. Standalone .html assets are emitted as `<slug>.html`;
 *    Workers `html_handling: auto-trailing-slash` (default) serves them at the
 *    live extensionless URL (`/fa25-anthro105/assets/mystery-fossil-GREEN`).
 *    Stale files are pruned (keep-list: favicon.png, fonts/, .gitignore).
 *
 * 2. Emit `src/lib/generated/nav.json` — the Explorer tree as a static module
 *    import. Importing it (instead of returning it from a layout `load`) keeps
 *    the ~60 kB nav payload out of every prerendered page's data script; it
 *    ships once in a shared JS chunk.
 *
 * 3. Emit `.generated/expected-404.json` — every internal href/src in the
 *    rendered corpus that resolves to nothing. These are bug-for-bug parity
 *    with links that are *also broken on the live site* (see
 *    `.generated/warnings.txt`; golden-diff link parity is 100%). The strict
 *    prerender crawler (`handleHttpError`) fails on any 404 NOT in this list.
 *
 * Size guard (per ARCHITECTURE.md §D): warn >20 MiB, fail >25 MiB per file.
 */

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
import { contentEntries, displayRoute, getManifest, navTree } from '../src/lib/server/content';

const SITE_DIR = path.resolve(import.meta.dir, '..');
const GENERATED = path.join(SITE_DIR, '.generated');
const STATIC_DIR = path.join(SITE_DIR, 'static');

if (!existsSync(path.join(GENERATED, 'content-manifest.json'))) {
	console.error('prepare-static: .generated/content-manifest.json missing.');
	console.error('Run `bun run build:content` first.');
	process.exit(1);
}

const manifest = getManifest();
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
writeFileSync(navOut, JSON.stringify(navTree()));
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
	`expected-404: ${sorted.length} unique live-broken link targets whitelisted for the crawler`
);
console.log(
	`routes: ${contentEntries().length} content + ${Object.keys(manifest.tags).length + 1} tag + 2 xml + /404`
);
