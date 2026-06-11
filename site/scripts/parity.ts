/**
 * Golden-diff parity harness (ARCHITECTURE.md Phase 1 exit criteria).
 *
 * Compares the Quartz baseline build (repo-root public/, rebuilt via
 * `npx quartz build`) against the SvelteKit prebuild output (site/.generated):
 *
 *  1. SLUG PARITY — every baseline *.html path becomes a full slug
 *     (path minus ".html"; includes leaf pages, folder index pages, tag pages,
 *     the /tags index and 404). The new-side expected slug set is
 *     manifest pages ∪ folder pages (<dir>/index) ∪ tag pages (tags/<tag>)
 *     ∪ {tags/index, 404}. Gate: 100% after individually-justified exclusions.
 *
 *  2. LINK PARITY — for every baseline content page, extract all
 *     <a data-slug=… href=…> anchors (data-slug is set exclusively by the
 *     CrawlLinks transformer, i.e. exactly the content-area resolved links;
 *     chrome links — Explorer, Backlinks, TagList, breadcrumbs, listings —
 *     never carry it). Normalize hrefs to absolute (URL-resolved against the
 *     page's full slug, trailing slash stripped, percent-decoded) and compare
 *     per-page multisets of (data-slug, normalized-href, hash) records against
 *     the same extraction over site/.generated/pages/<slug>.json html.
 *     Gate: ≥99.9% of baseline records matched, residual diffs explained.
 *
 * KNOWN-OK normalizations (each is an explicitly justified divergence, see
 * site/scripts/build-content.ts header + ARCHITECTURE.md §1.7/§4):
 *   - trailing slash: Quartz emits folder links as "…/dir/", the new site uses
 *     trailingSlash:'never'; both canonicalize to the same resource under
 *     Workers' auto-trailing-slash handling → compare with trailing slash
 *     stripped (root stays "/").
 *   - relative vs root-absolute href form: browser-equivalent after URL
 *     resolution against the page URL → compare resolved pathnames.
 *
 * Emits site/.generated/parity-report.md and exits non-zero if gates fail.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { fromHtml } from 'hast-util-from-html';
import { visit } from 'unist-util-visit';
import type { Element, Root as HastRoot } from 'hast';

const SITE_DIR = path.resolve(import.meta.dir, '..');
const REPO_ROOT = path.resolve(SITE_DIR, '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');
const GEN_DIR = path.join(SITE_DIR, '.generated');
const REPORT = path.join(GEN_DIR, 'parity-report.md');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function walk(dir: string, out: string[] = [], base = dir): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(p, out, base);
		else out.push(path.relative(base, p));
	}
	return out;
}

const CONTENT_DIR = path.join(REPO_ROOT, 'content');

/** git evidence for a content/-relative path: is it tracked in its owning
 * repo (submodule or superproject), and does a .gitignore pattern match it? */
function gitEvidence(rel: string): { exists: boolean; tracked: boolean; ignoredBy: string | null } {
	const abs = path.join(CONTENT_DIR, rel);
	if (!fs.existsSync(abs)) return { exists: false, tracked: false, ignoredBy: null };
	const firstSeg = rel.split('/')[0];
	const subDir = path.join(CONTENT_DIR, firstSeg);
	const isSub = fs.existsSync(path.join(subDir, '.git'));
	const repo = isSub ? subDir : REPO_ROOT;
	const inRepo = isSub ? rel.slice(firstSeg.length + 1) : `content/${rel}`;
	let tracked = false;
	try {
		execFileSync('git', ['-C', repo, 'ls-files', '--error-unmatch', '--', inRepo], {
			stdio: 'pipe'
		});
		tracked = true;
	} catch {
		/* untracked */
	}
	let ignoredBy: string | null = null;
	try {
		const out = execFileSync(
			'git',
			['-C', repo, 'check-ignore', '-v', '--no-index', '--', inRepo],
			{ encoding: 'utf8', stdio: 'pipe' }
		);
		ignoredBy = out.trim().split('\t')[0] || null;
	} catch {
		/* not ignored */
	}
	return { exists: true, tracked, ignoredBy };
}

interface LinkRecord {
	dataSlug: string;
	href: string; // normalized absolute path
	hash: string; // decoded #anchor ('' if none)
}

/** Resolve an href against the page's full slug and normalize:
 * percent-decoded pathname, trailing slash stripped (root stays '/'). */
function normalizeHref(href: string, pageFullSlug: string): { href: string; hash: string } {
	const url = new URL(href, 'https://base.com/' + pageFullSlug);
	let p = decodeURIComponent(url.pathname);
	if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
	let hash = url.hash;
	try {
		hash = decodeURIComponent(hash);
	} catch {
		/* keep raw */
	}
	return { href: p, hash };
}

function extractLinkRecords(tree: HastRoot, pageFullSlug: string): LinkRecord[] {
	const records: LinkRecord[] = [];
	visit(tree, 'element', (node: Element) => {
		if (
			node.tagName === 'a' &&
			node.properties &&
			typeof node.properties.href === 'string' &&
			typeof node.properties.dataSlug === 'string'
		) {
			const { href, hash } = normalizeHref(node.properties.href, pageFullSlug);
			records.push({ dataSlug: node.properties.dataSlug, href, hash });
		}
	});
	return records;
}

const recordKey = (r: LinkRecord) => `${r.dataSlug}${r.href}${r.hash}`;

/** multiset diff: returns [onlyInA, onlyInB] */
function multisetDiff(a: string[], b: string[]): [string[], string[]] {
	const count = new Map<string, number>();
	for (const k of a) count.set(k, (count.get(k) ?? 0) + 1);
	for (const k of b) count.set(k, (count.get(k) ?? 0) - 1);
	const onlyA: string[] = [];
	const onlyB: string[] = [];
	for (const [k, n] of count) {
		for (let i = 0; i < n; i++) onlyA.push(k);
		for (let i = 0; i < -n; i++) onlyB.push(k);
	}
	return [onlyA.sort(), onlyB.sort()];
}

// ---------------------------------------------------------------------------
// load both sides
// ---------------------------------------------------------------------------
if (!fs.existsSync(PUBLIC_DIR)) {
	console.error(`baseline not found at ${PUBLIC_DIR} — run \`npx quartz build\` first`);
	process.exit(2);
}
if (!fs.existsSync(path.join(GEN_DIR, 'content-manifest.json'))) {
	console.error(`manifest not found — run \`bun scripts/build-content.ts\` first`);
	process.exit(2);
}

interface Manifest {
	pages: Record<string, { relativePath: string }>;
	folders: string[];
	tags: Record<string, string[]>;
	assets: string[];
	htmlAssets: string[];
}
const manifest: Manifest = JSON.parse(
	fs.readFileSync(path.join(GEN_DIR, 'content-manifest.json'), 'utf8')
);
const droppedUrls = new Set(
	fs
		.readFileSync(path.join(GEN_DIR, 'dropped-urls.txt'), 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((l) => l.replace(/^\//, ''))
);

const allPublicFiles = walk(PUBLIC_DIR);
const baselineHtml = allPublicFiles.filter((f) => f.endsWith('.html')).sort();
const baselineSlugs = new Set(baselineHtml.map((f) => f.slice(0, -'.html'.length)));

// new-side expected slug set
const pageSlugs = new Set(Object.keys(manifest.pages));
const folderPageSlugs = new Set(manifest.folders.map((f) => `${f}/index`));
const tagPageSlugs = new Set(Object.keys(manifest.tags).map((t) => `tags/${t}`));
const ROUTE_PROVIDED = new Set(['tags/index', '404']); // /tags index route + SvelteKit error page
const newSlugs = new Set([...pageSlugs, ...folderPageSlugs, ...tagPageSlugs, ...ROUTE_PROVIDED]);

// ---------------------------------------------------------------------------
// 1. slug parity
// ---------------------------------------------------------------------------
interface SlugDiff {
	slug: string;
	kind: 'missing' | 'extra'; // missing = in baseline only; extra = in new only
	category: string;
	justified: boolean;
}
const slugDiffs: SlugDiff[] = [];
const justifiedExtraPages = new Set<string>();
const justifiedMissingPages = new Set<string>();

// pass 1: page-level diffs with per-slug git evidence
for (const slug of [...baselineSlugs].sort()) {
	if (newSlugs.has(slug) || slug.endsWith('/index')) continue;
	if (droppedUrls.has(slug)) {
		// a *.html-emitting source the whitelist intentionally dropped
		slugDiffs.push({
			slug,
			kind: 'missing',
			category: 'whitelist-dropped (in dropped-urls.txt)',
			justified: true
		});
		justifiedMissingPages.add(slug);
		continue;
	}
	// baseline page our pipeline lacks — locate its markdown source
	const ev = gitEvidence(slug + '.md');
	if (ev.exists && !ev.tracked) {
		slugDiffs.push({
			slug,
			kind: 'missing',
			category: `untracked local file (content/${slug}.md is not tracked by git — never present in CI/live builds)`,
			justified: true
		});
		justifiedMissingPages.add(slug);
		continue;
	}
	slugDiffs.push({ slug, kind: 'missing', category: 'UNEXPLAINED missing slug', justified: false });
}
for (const slug of [...newSlugs].sort()) {
	if (baselineSlugs.has(slug) || slug.endsWith('/index')) continue;
	const rel = manifest.pages[slug]?.relativePath;
	if (rel) {
		const ev = gitEvidence(rel);
		if (ev.tracked && ev.ignoredBy) {
			slugDiffs.push({
				slug,
				kind: 'extra',
				category: `tracked-but-gitignored md (${ev.ignoredBy} hid it from Quartz's globby; ships per approved git-ls-files whitelist; adds a page, breaks no live URL)`,
				justified: true
			});
			justifiedExtraPages.add(slug);
			continue;
		}
	}
	slugDiffs.push({ slug, kind: 'extra', category: 'UNEXPLAINED extra slug', justified: false });
}

// pass 2: folder pages — justified only as a pure consequence of justified page diffs
for (const slug of [...baselineSlugs].sort()) {
	if (newSlugs.has(slug) || !slug.endsWith('/index')) continue;
	const dir = slug.slice(0, -'/index'.length) + '/';
	const newUnder = [...newSlugs].some((s) => s.startsWith(dir));
	const baselinePagesUnder = [...baselineSlugs].filter(
		(s) => s.startsWith(dir) && !s.endsWith('/index')
	);
	if (
		!newUnder &&
		baselinePagesUnder.length > 0 &&
		baselinePagesUnder.every((s) => justifiedMissingPages.has(s))
	) {
		slugDiffs.push({
			slug,
			kind: 'missing',
			category: 'folder page whose every member page is itself a justified missing page',
			justified: true
		});
		continue;
	}
	slugDiffs.push({ slug, kind: 'missing', category: 'UNEXPLAINED missing slug', justified: false });
}
for (const slug of [...newSlugs].sort()) {
	if (baselineSlugs.has(slug) || !slug.endsWith('/index')) continue;
	const dir = slug.slice(0, -'/index'.length) + '/';
	const baselineUnder = [...baselineSlugs].some((s) => s.startsWith(dir));
	const newPagesUnder = [...pageSlugs].filter((s) => s.startsWith(dir));
	if (
		!baselineUnder &&
		newPagesUnder.length > 0 &&
		newPagesUnder.every((s) => justifiedExtraPages.has(s))
	) {
		slugDiffs.push({
			slug,
			kind: 'extra',
			category: 'folder page whose every member page is itself a justified extra page',
			justified: true
		});
		continue;
	}
	slugDiffs.push({ slug, kind: 'extra', category: 'UNEXPLAINED extra slug', justified: false });
}

// tag parity detail (critique §E1: 168 case-sensitive tag slugs)
const baselineTagSlugs = new Set(
	[...baselineSlugs].filter((s) => s.startsWith('tags/') && s !== 'tags/index')
);
const newTagSlugs = new Set([...tagPageSlugs]);
const [tagsOnlyBaseline, tagsOnlyNew] = [
	[...baselineTagSlugs].filter((t) => !newTagSlugs.has(t)).sort(),
	[...newTagSlugs].filter((t) => !baselineTagSlugs.has(t)).sort()
];

// ---------------------------------------------------------------------------
// 2. link parity
// ---------------------------------------------------------------------------
interface PageLinkDiff {
	slug: string;
	onlyBaseline: string[];
	onlyNew: string[];
	note?: string;
}
const pageLinkDiffs: PageLinkDiff[] = [];
let totalBaselineRecords = 0;
let totalNewRecords = 0;
let matchedRecords = 0;
let comparedPages = 0;
const skippedPages: string[] = [];

for (const slug of [...pageSlugs].sort()) {
	const baselineFile = path.join(PUBLIC_DIR, slug + '.html');
	if (!fs.existsSync(baselineFile)) {
		skippedPages.push(slug);
		continue;
	}
	const genFile = path.join(GEN_DIR, 'pages', slug + '.json');
	if (!fs.existsSync(genFile)) {
		skippedPages.push(slug);
		continue;
	}
	comparedPages++;

	const baseTree = fromHtml(fs.readFileSync(baselineFile, 'utf8'));
	const baseRecords = extractLinkRecords(baseTree, slug);

	const genHtml = JSON.parse(fs.readFileSync(genFile, 'utf8')).html as string;
	const genTree = fromHtml(genHtml, { fragment: true });
	const genRecords = extractLinkRecords(genTree, slug);

	totalBaselineRecords += baseRecords.length;
	totalNewRecords += genRecords.length;

	const [onlyBaseline, onlyNew] = multisetDiff(
		baseRecords.map(recordKey),
		genRecords.map(recordKey)
	);
	matchedRecords += baseRecords.length - onlyBaseline.length;
	if (onlyBaseline.length > 0 || onlyNew.length > 0) {
		pageLinkDiffs.push({ slug, onlyBaseline, onlyNew });
	}
}

// ---------------------------------------------------------------------------
// 3. full output-file diff (informational; critique §B)
// ---------------------------------------------------------------------------
const QUARTZ_INTERNAL = new Set([
	'index.css',
	'index.xml',
	'sitemap.xml',
	'postscript.js',
	'prescript.js',
	'favicon.ico'
]);
const baselineOther = allPublicFiles
	.filter((f) => !f.endsWith('.html'))
	.filter((f) => !QUARTZ_INTERNAL.has(f) && !f.startsWith('static/'))
	.sort();
const newAssetSet = new Set(manifest.assets);
// quartz emits whitelisted .html assets extensionless at their slug, so do we
const assetOnlyBaseline = baselineOther.filter(
	(f) => !newAssetSet.has(f) && !newAssetSet.has(f.replace(/\.html$/, ''))
);
const assetJustified: { file: string; reason: string }[] = [];
const assetUnexplained: string[] = [];
for (const f of assetOnlyBaseline) {
	if (droppedUrls.has(f)) {
		assetJustified.push({ file: f, reason: 'whitelist-dropped (in dropped-urls.txt)' });
		continue;
	}
	// public/ paths are slugified; for files whose name survives slugging
	// unchanged we can check the source's git status directly
	const ev = gitEvidence(f);
	if (ev.exists && !ev.tracked) {
		assetJustified.push({
			file: f,
			reason: `untracked local file${ev.ignoredBy ? ` (gitignored by ${ev.ignoredBy}, globby served it anyway)` : ''} — never present in CI/live builds`
		});
		continue;
	}
	assetUnexplained.push(f);
}
const assetOnlyNew = [...newAssetSet]
	.filter((s) => !fs.existsSync(path.join(PUBLIC_DIR, s)) && !baselineSlugs.has(s))
	.sort();

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
const unexplainedSlugDiffs = slugDiffs.filter((d) => !d.justified);
const justifiedSlugDiffs = slugDiffs.filter((d) => d.justified);
const justifiedSet = new Set(justifiedSlugDiffs.map((d) => d.slug));
// parity over the union universe minus individually-justified slugs
const slugUniverse = [...new Set([...baselineSlugs, ...newSlugs])].filter(
	(s) => !justifiedSet.has(s)
);
const slugMatched = slugUniverse.filter((s) => baselineSlugs.has(s) && newSlugs.has(s)).length;
const slugParityPct = (100 * slugMatched) / Math.max(1, slugUniverse.length);

const linkParityPct = totalBaselineRecords === 0 ? 100 : (100 * matchedRecords) / totalBaselineRecords;

const lines: string[] = [];
const log = (s = '') => lines.push(s);

log(`# Golden-diff parity report`);
log();
log(`Generated: ${new Date().toISOString()}`);
log(`Baseline: ${PUBLIC_DIR} (${baselineHtml.length} html pages, ${allPublicFiles.length} files)`);
log(
	`New side: ${GEN_DIR} (${pageSlugs.size} pages, ${folderPageSlugs.size} folder pages, ${tagPageSlugs.size} tag pages)`
);
log();
log(`## Summary`);
log();
log(`| metric | value |`);
log(`|---|---|`);
log(`| slug parity (after justified exclusions) | ${slugParityPct.toFixed(3)}% |`);
log(`| unexplained slug diffs | ${unexplainedSlugDiffs.length} |`);
log(`| justified slug diffs | ${justifiedSlugDiffs.length} |`);
log(`| pages compared for links | ${comparedPages} |`);
log(`| baseline link records | ${totalBaselineRecords} |`);
log(`| new link records | ${totalNewRecords} |`);
log(`| matched link records | ${matchedRecords} |`);
log(`| link parity | ${linkParityPct.toFixed(4)}% |`);
log(`| pages with link diffs | ${pageLinkDiffs.length} |`);
log(`| tag slugs baseline/new | ${baselineTagSlugs.size}/${newTagSlugs.size} |`);
log();

log(`## Slug diffs`);
log();
if (slugDiffs.length === 0) {
	log(`None — slug sets identical (${baselineSlugs.size} baseline vs ${newSlugs.size} new).`);
} else {
	for (const d of slugDiffs) {
		log(`- [${d.justified ? 'JUSTIFIED' : 'UNEXPLAINED'}] ${d.kind}: \`${d.slug}\` — ${d.category}`);
	}
}
log();

log(`## Tag-slug parity (case-sensitive)`);
log();
log(`baseline tag pages: ${baselineTagSlugs.size}; new tag pages: ${newTagSlugs.size}`);
if (tagsOnlyBaseline.length === 0 && tagsOnlyNew.length === 0) {
	log(`All tag slugs match exactly (case-sensitive).`);
} else {
	for (const t of tagsOnlyBaseline) log(`- baseline-only tag page: \`${t}\``);
	for (const t of tagsOnlyNew) log(`- new-only tag page: \`${t}\``);
}
log();

log(`## Link diffs (per page, content-area <a data-slug> records)`);
log();
log(`Record = \`data-slug | normalized-href | #anchor\`.`);
log();
if (pageLinkDiffs.length === 0) {
	log(`None — all ${totalBaselineRecords} baseline link records matched.`);
} else {
	for (const d of pageLinkDiffs) {
		log(`### ${d.slug}`);
		for (const k of d.onlyBaseline) log(`- baseline-only: \`${k.split('').join(' | ')}\``);
		for (const k of d.onlyNew) log(`- new-only: \`${k.split('').join(' | ')}\``);
		log();
	}
}
if (skippedPages.length > 0) {
	log(`Pages skipped (no counterpart): ${skippedPages.map((s) => `\`${s}\``).join(', ')}`);
	log();
}

log(`## Non-html output files (informational, critique §B)`);
log();
log(
	`Baseline non-html, non-static files: ${baselineOther.length}; new whitelisted assets: ${newAssetSet.size}.`
);
log(`- baseline-only, justified: ${assetJustified.length}`);
const reasonCounts = new Map<string, number>();
for (const j of assetJustified) {
	const k = j.reason.startsWith('whitelist-dropped') ? j.reason : 'untracked local file';
	reasonCounts.set(k, (reasonCounts.get(k) ?? 0) + 1);
}
for (const [reason, n] of reasonCounts) log(`  - ${reason}: ${n}`);
for (const j of assetJustified.filter((x) => !x.reason.startsWith('whitelist-dropped'))) {
	log(`  - \`${j.file}\` — ${j.reason}`);
}
if (assetUnexplained.length > 0) {
	log(`- baseline-only, UNEXPLAINED:`);
	for (const f of assetUnexplained) log(`  - \`${f}\``);
} else {
	log(`- baseline-only, unexplained: 0`);
}
if (assetOnlyNew.length > 0) {
	log(`- new-only assets (not in baseline):`);
	for (const f of assetOnlyNew) log(`  - \`${f}\``);
} else {
	log(`- new-only assets: 0`);
}
log();

fs.writeFileSync(REPORT, lines.join('\n') + '\n');
console.log(lines.slice(0, 30).join('\n'));
console.log(`\nfull report: ${REPORT}`);

const pass =
	unexplainedSlugDiffs.length === 0 && linkParityPct >= 99.9 && assetUnexplained.length === 0;
console.log(
	`\nRESULT: slugParity=${slugParityPct.toFixed(3)}% (unexplained=${unexplainedSlugDiffs.length}) linkParity=${linkParityPct.toFixed(4)}% assetUnexplained=${assetUnexplained.length} -> ${pass ? 'PASS' : 'FAIL'}`
);
process.exit(pass ? 0 : 1);
