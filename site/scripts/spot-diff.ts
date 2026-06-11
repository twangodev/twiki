/**
 * Phase 2b spot-diff: content-fidelity comparison of representative heavy pages.
 *
 * Compares the Quartz baseline (repo-root public/<page>.html, <article
 * class="popover-hint"> body) against the new pipeline's rendered HTML
 * (site/.generated/pages/<slug>.json .html — exactly what gets {@html}-injected
 * into the prerendered page). Structure-level, not pixel-level:
 *   - feature counts (callouts, collapsed callouts, fences, tables, images,
 *     katex spans, iframes, checkboxes, internal/external links, mermaid)
 *   - normalized text-content diff (tags stripped, chrome/anchors removed)
 *
 * Run: bun scripts/spot-diff.ts   (after bun run build:content)
 */
import fs from 'node:fs';
import path from 'node:path';

const SITE_DIR = path.resolve(import.meta.dir, '..');
const REPO_ROOT = path.resolve(SITE_DIR, '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');
const PAGES_DIR = path.join(SITE_DIR, '.generated', 'pages');

// representative heavy pages (slug form; baseline file is public/<slug>.html
// or public/<slug>/index.html)
const PAGES = [
	'index', // homepage w/ ![[course-log]] transclusion
	'course-log',
	'fa25-cs354/exams/exam-1/practice', // 2,308-style collapsed [!success] + asm fences
	'fa25-cs354/exams/exam-1/review', // callout+code heavy cheat sheet
	'sp26-cs537/exams/midterm-1/sample-1/index', // cs537 exam, callouts+code+checkboxes
	'sp26-cs537/README',
	'sp26-cs544/README',
	'fa25-cs540/exams/final/review', // KaTeX-heavy
	'fa25-cs540/exams/midterm/review', // KaTeX + callouts
	'fa25-anthro105/labs/lab-11', // mystery-fossil .html asset links
	'fa25-anthro105/textbook/ch-06', // |WxH image sizing
	'sp26-cs537/textbook/ch-27', // long code-heavy textbook conversion
	'sp26-cs544/lectures/lecture-25', // mermaid-heavy
	'fa24-asianam160/README', // prose/essay course
	'fa25-music113/README'
] as const;

function baselinePath(slug: string): string | null {
	for (const p of [path.join(PUBLIC_DIR, slug + '.html'), path.join(PUBLIC_DIR, slug, 'index.html')]) {
		if (fs.existsSync(p)) return p;
	}
	return null;
}

function extractArticle(html: string): string {
	// ContentPage emits <article class="popover-hint">; FolderPage (dir with
	// index.md) emits <article class> with the same content inside.
	const m = html.match(/<article class(?:="popover-hint")?>([\s\S]*?)<\/article>/);
	return m ? m[1] : '';
}

/** Quartz-only chrome inside the article that the new site intentionally renders differently. */
function stripQuartzChrome(html: string): string {
	// heading-anchor links (rehype-autolink-headings) — cca chrome handles anchors
	html = html.replace(/<a role="anchor"[\s\S]*?<\/a>/g, '');
	return html;
}

/** New-site-only additions relative to the Quartz article body. */
function stripNewChrome(html: string): string {
	return html;
}

const normalizations: [RegExp, string][] = [
	// katex: MathML/annotation duplication differs (quartz emitted mathml+html,
	// we emit html-only) — collapse every katex root to a marker
	[/<span class="katex(?:-display)?"[\s\S]*?<\/span><\/span><\/span>/g, '⟨math⟩'],
	// svg internals irrelevant for text diff
	[/<svg[\s\S]*?<\/svg>/g, ''],
	// tags
	[/<[^>]+>/g, ' '],
	// entities that differ in escaping between emitters
	[/&#x3C;|&lt;/g, '<'],
	[/&#x26;|&amp;/g, '&'],
	[/&#x3E;|&gt;/g, '>'],
	[/&quot;|&#x22;/g, '"'],
	[/&#x27;|&#39;/g, "'"],
	// whitespace
	[/\s+/g, ' ']
];

function textContent(html: string): string {
	for (const [re, sub] of normalizations) html = html.replace(re, sub);
	return html.trim();
}

function counts(html: string): Record<string, number> {
	const c = (re: RegExp) => (html.match(re) ?? []).length;
	return {
		callouts: c(/class="callout /g),
		collapsed: c(/is-collapsed/g),
		fences: c(/<pre[ >]/g) + 0,
		shikiOrPretty: c(/class="shiki /g) + c(/data-rehype-pretty-code-figure/g),
		tables: c(/<table/g),
		images: c(/<img /g),
		katex: c(/class="katex"/g),
		iframes: c(/<iframe/g),
		checkboxes: c(/type="checkbox"/g),
		internalLinks: c(/class="internal/g),
		externalLinks: c(/class="external"|class="external /g),
		mermaid: c(/class="mermaid"/g),
		highlights: c(/text-highlight/g),
		headings: c(/<h[1-6][ >]/g)
	};
}

/** first point of divergence between two strings, with context */
function firstDiff(a: string, b: string): string | null {
	if (a === b) return null;
	let i = 0;
	const n = Math.min(a.length, b.length);
	while (i < n && a[i] === b[i]) i++;
	const ctx = (s: string) => s.slice(Math.max(0, i - 80), i + 120).replace(/\n/g, ' ');
	return `  old: …${ctx(a)}…\n  new: …${ctx(b)}…`;
}

let failures = 0;
for (const slug of PAGES) {
	const bp = baselinePath(slug);
	const np = path.join(PAGES_DIR, slug + '.json');
	if (!bp || !fs.existsSync(np)) {
		console.log(`✗ ${slug}: missing ${!bp ? 'baseline' : 'new page json'}`);
		failures++;
		continue;
	}
	const oldHtml = stripQuartzChrome(extractArticle(fs.readFileSync(bp, 'utf8')));
	const newHtml = stripNewChrome(JSON.parse(fs.readFileSync(np, 'utf8')).html as string);

	const co = counts(oldHtml);
	const cn = counts(newHtml);
	const mismatches = Object.keys(co).filter((k) => co[k] !== cn[k]);

	const to = textContent(oldHtml);
	const tn = textContent(newHtml);
	const sameText = to === tn;

	const status = mismatches.length === 0 && sameText ? '✓' : '∆';
	if (status === '∆') failures++;
	console.log(`${status} ${slug}`);
	for (const k of mismatches) console.log(`    count ${k}: old=${co[k]} new=${cn[k]}`);
	if (!sameText) {
		const d = firstDiff(to, tn);
		if (d) console.log(d);
	}
}
console.log(failures === 0 ? '\nall pages match' : `\n${failures} page(s) with differences`);
