import { preserveCurrency } from './lib/currency';
/** Render tracked notes, resolve links and transclusions, and emit pages, assets, and graph data. */
import fs from 'node:fs';
import { writeChanged, copyChanged, pruneOutputs } from './lib/output';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

import matter from 'gray-matter';
import yaml from 'js-yaml';
import { unified, type Plugin } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkSmartypants from 'remark-smartypants';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import rehypeKatex from 'rehype-katex';
import { SKIP as SKIP_VISIT, visit } from 'unist-util-visit';
import { toString as mdastToString } from 'mdast-util-to-string';
import { toString as hastToString } from 'hast-util-to-string';
import { toHtml } from 'hast-util-to-html';
import Slugger from 'github-slugger';
import { createHighlighter, type Highlighter } from 'shiki';
import type { Root as MdRoot } from 'mdast';
import type { Element, ElementContent, Root as HtmlRoot } from 'hast';

import {
	type FilePath,
	type FullSlug,
	type SimpleSlug,
	type RelativeURL,
	type TransformOptions,
	getFileExtension,
	joinSegments,
	getAllSegmentPrefixes,
	normalizeHastElement,
	simplifySlug,
	slugifyFilePath,
	slugTag,
	splitAnchor,
	stripSlashes,
	transformLink
} from './lib/slug';
import {
	type OfmFileData,
	ofmBlockReferences,
	ofmCallouts,
	ofmMermaid,
	ofmReplacements,
	ofmTextTransform,
	ofmVideoEmbed,
	ofmYouTubeEmbed
} from './lib/ofm';
import { applyAutoTags } from './lib/autotag';
import { buildGitDateMap, parseGitmodules, resolveDates } from './lib/lastmod';
import { contentAuthor } from '../src/lib/metadata';
import { publicationResolver, courseLicenseResolver } from './lib/publishing';
import { protectPublicLinks } from './lib/public-links';
import { parserFingerprint } from './fingerprint';

export async function compileContent() {
	const PIPELINE_VERSION = parserFingerprint();
	const SITE_DIR = path.resolve(import.meta.dirname, '..');
	const REPO_ROOT = process.env.WISCONSIN_CONTENT_REPO ?? path.resolve(SITE_DIR, '..');
	const publicEdition = process.env.VITE_PUBLIC_EDITION === 'true';
	const CONTENT_DIR = path.join(REPO_ROOT, 'content');
	const OUT_DIR = path.join(SITE_DIR, 'build/generated');
	const CACHE_DIR = path.join(OUT_DIR, 'cache');

	const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);
	const ASSET_EXTS = new Set([...IMAGE_EXTS, '.pdf', '.html']);

	const SIZE_WARN = 20 * 1024 * 1024;
	const SIZE_FAIL = 25 * 1024 * 1024;

	const warnings: string[] = [];
	const warn = (msg: string) => {
		warnings.push(msg);
	};

	// ---------------------------------------------------------------------------
	// stage 0 — discover
	// ---------------------------------------------------------------------------
	interface SourceFile {
		rel: string; // path relative to content/
		abs: string;
		slug: FullSlug;
		kind: 'page' | 'asset' | 'other';
		/** in Quartz's RESOLUTION slug set (build.ts globs "**\/*.*": basename must
		 * contain a dot). The Assets emitter globs "**" (everything non-md), so
		 * extensionless files (Makefile, LICENSE, gradlew…) are SERVED by Quartz but
		 * never participate in link resolution. We mirror both sets exactly. */
		inResolution: boolean;
	}

	function gitLsFiles(repoDir: string, pathspec?: string[]): string[] {
		const out = execFileSync('git', ['-C', repoDir, 'ls-files', ...(pathspec ?? [])], {
			encoding: 'utf8',
			maxBuffer: 1 << 28
		});
		return out.split('\n').filter((l) => l.length > 0);
	}

	/**
	 * Quartz's resolution discovery was globby("**\/*.*", { gitignore: true }) —
	 * i.e. visible files whose basename contains a dot and with no dot-leading
	 * path segment. We use git ls-files (authoritative, kills untracked junk) and
	 * apply the same visibility rule so the resolution slug set matches Quartz's
	 * allSlugs. The served set is wider: Quartz's Assets emitter globs "**", which
	 * additionally picks up extensionless basenames (see SourceFile.inResolution).
	 */
	function dotLed(rel: string): boolean {
		return rel.split('/').some((s) => s.startsWith('.'));
	}
	function globVisible(rel: string): boolean {
		if (dotLed(rel)) return false;
		const base = rel.split('/').pop()!;
		return base.slice(1).includes('.');
	}

	function discover(): { files: SourceFile[]; submoduleNames: string[] } {
		const submodules = parseGitmodules(path.join(REPO_ROOT, '.gitmodules')).filter((s) =>
			s.path.startsWith('content/')
		);
		const submodulePaths = new Set(submodules.map((s) => s.path));
		const rels: string[] = [];

		for (const sub of submodules) {
			const name = sub.path.slice('content/'.length);
			for (const f of gitLsFiles(sub.fullPath)) {
				rels.push(`${name}/${f}`);
			}
		}
		for (const f of gitLsFiles(REPO_ROOT, ['--', 'content'])) {
			if (submodulePaths.has(f)) continue; // gitlink entries
			rels.push(f.slice('content/'.length));
		}

		const files: SourceFile[] = [];
		for (const rel of rels) {
			if (rel.split('/').includes('publish.yaml')) continue;
			const source = path.join(CONTENT_DIR, rel);
			if (
				!fs.existsSync(source) ||
				!fs.lstatSync(source).isFile() ||
				fs.realpathSync(source) !== source
			)
				continue;
			// dot-led paths are invisible to every Quartz glob (globby dot:false)
			if (dotLed(rel)) continue;
			const ext = (getFileExtension(rel) ?? '').toLowerCase();
			const kind: SourceFile['kind'] =
				ext === '.md' ? 'page' : ASSET_EXTS.has(ext) ? 'asset' : 'other';
			files.push({
				rel,
				abs: path.join(CONTENT_DIR, rel),
				slug: slugifyFilePath(rel as FilePath),
				kind,
				inResolution: globVisible(rel)
			});
		}
		files.sort((a, b) => a.rel.localeCompare(b.rel));
		return { files, submoduleNames: submodules.map((s) => s.path.slice('content/'.length)) };
	}

	// ---------------------------------------------------------------------------
	// stage 1 — parse (per file, cacheable)
	// ---------------------------------------------------------------------------
	interface TocEntry {
		depth: number;
		text: string;
		slug: string;
	}

	interface PageParse {
		markdown: string;
		slug: FullSlug;
		rel: string;
		frontmatter: Record<string, unknown> & { title: string };
		heading?: string;
		title: string;
		description: string;
		tags: string[];
		toc: TocEntry[];
		draft: boolean;
		hasMermaid: boolean;
		wordCount: number;
		blocks: Record<string, Element>;
		tree: HtmlRoot;
	}

	let highlighter: Highlighter | undefined;
	const SHIKI_LANGS = [
		'asm',
		'bash',
		'c',
		'console',
		'cpp',
		'csharp',
		'css',
		'csv',
		'diff',
		'dockerfile',
		'go',
		'html',
		'ini',
		'java',
		'javascript',
		'json',
		'jsx',
		'kotlin',
		'latex',
		'lua',
		'makefile',
		'markdown',
		'nginx',
		'perl',
		'php',
		'python',
		'r',
		'regex',
		'ruby',
		'rust',
		'scss',
		'shell',
		'sql',
		'text',
		'toml',
		'tsx',
		'typescript',
		'verilog',
		'xml',
		'yaml'
	];
	const shikiLangAliases: Record<string, string> = {
		// languages seen in the corpus that shiki has no grammar for / different name
		'c++': 'cpp',
		sh: 'bash',
		zsh: 'bash',
		shellsession: 'console',
		plaintext: 'text',
		txt: 'text',
		gitignore: 'ini',
		mysql: 'sql'
	};
	const unknownLangs = new Map<string, number>();

	async function getHighlighter(): Promise<Highlighter> {
		highlighter ??= await createHighlighter({
			themes: ['github-light', 'github-dark'],
			langs: SHIKI_LANGS
		});
		return highlighter;
	}

	/** Shiki dual-theme highlighting (replaces rehype-pretty-code; cca pattern). */
	function rehypeShiki(hl: Highlighter) {
		return (tree: HtmlRoot) => {
			visit(tree, 'element', (node, index, parent) => {
				if (
					node.tagName !== 'pre' ||
					!parent ||
					index === undefined ||
					node.children.length !== 1 ||
					(node.children[0] as Element).tagName !== 'code'
				) {
					return;
				}
				const code = node.children[0] as Element;
				const classNames = (code.properties?.className ?? []) as string[];
				if (classNames.includes('mermaid')) return; // client-side island
				// $$ math blocks: remark-math emits <pre><code class="language-math math-display">,
				// consumed by rehype-katex downstream — leave untouched
				if (classNames.includes('math-display') || classNames.includes('math-inline')) return;
				let lang =
					classNames
						.find((c) => c.startsWith('language-'))
						?.slice('language-'.length)
						.toLowerCase() ?? 'text';
				lang = shikiLangAliases[lang] ?? lang;
				if (!['text'].includes(lang) && !hl.getLoadedLanguages().includes(lang)) {
					unknownLangs.set(lang, (unknownLangs.get(lang) ?? 0) + 1);
					lang = 'text';
				}
				const source = hastToString(code).replace(/\n$/, '');
				const highlighted = hl.codeToHast(source, {
					lang,
					themes: { light: 'github-light', dark: 'github-dark' },
					defaultColor: false
				});
				const pre = highlighted.children[0] as Element;
				// keep the original language- class on the inner <code> for styling/copy
				const newCode = pre.children[0] as Element;
				newCode.properties = { ...newCode.properties, className: classNames };
				parent.children[index] = pre;
			});
		};
	}

	// vendored from quartz/util/escape.ts
	const escapeHTML = (unsafe: string) =>
		unsafe
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#039;');

	// vendored from quartz/plugins/transformers/description.ts (defaults)
	const urlRegex = new RegExp(
		/(https?:\/\/)?(?<domain>([\da-z\.-]+)\.([a-z\.]{2,6})(:\d+)?)(?<path>[\/\w\.-]*)(\?[\/\w\.=&;-]*)?/,
		'g'
	);
	function computeDescription(tree: HtmlRoot, frontmatterDescription?: string): string {
		let fmDesc = frontmatterDescription;
		let text = escapeHTML(hastToString(tree));
		fmDesc = fmDesc?.replace(urlRegex, '$<domain>$<path>');
		text = text.replace(urlRegex, '$<domain>$<path>');
		if (fmDesc) return fmDesc;

		const desc = text;
		const sentences = desc.replace(/\s+/g, ' ').split(/\.\s/);
		let finalDesc = '';
		let sentenceIdx = 0;
		while (sentenceIdx < sentences.length) {
			const sentence = sentences[sentenceIdx];
			if (!sentence) break;
			const currentSentence = sentence.endsWith('.') ? sentence : sentence + '.';
			const nextLength = finalDesc.length + currentSentence.length + (finalDesc ? 1 : 0);
			if (nextLength <= 150 || sentenceIdx === 0) {
				finalDesc += (finalDesc ? ' ' : '') + currentSentence;
				sentenceIdx++;
			} else {
				break;
			}
		}
		return finalDesc.length > 300 ? finalDesc.slice(0, 300) + '...' : finalDesc;
	}

	// frontmatter coalescing, vendored from quartz/plugins/transformers/frontmatter.ts
	function coalesceAliases(data: Record<string, any>, aliases: string[]) {
		for (const alias of aliases) {
			if (data[alias] !== undefined && data[alias] !== null) return data[alias];
		}
	}
	function coerceToArray(input: unknown): string[] | undefined {
		if (input === undefined || input === null) return undefined;
		let arr: unknown[] = Array.isArray(input)
			? input
			: String(input)
					.split(',')
					.map((tag: string) => tag.trim());
		return arr
			.filter((tag: unknown) => typeof tag === 'string' || typeof tag === 'number')
			.map((tag) => String(tag));
	}

	function sha256(s: string): string {
		return crypto.createHash('sha256').update(s).digest('hex');
	}

	async function parsePage(file: SourceFile): Promise<PageParse> {
		const raw = fs.readFileSync(file.abs, 'utf8');
		const cacheKey = sha256(`${PIPELINE_VERSION}|${file.rel}|${raw}`);
		const cacheFile = path.join(CACHE_DIR, 'stage1', cacheKey.slice(0, 2), cacheKey + '.json');
		if (fs.existsSync(cacheFile)) {
			try {
				return JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as PageParse;
			} catch {
				/* re-parse */
			}
		}

		const { data: fmRaw, content } = matter(raw, {
			engines: {
				yaml: (s) => yaml.load(s, { schema: yaml.JSON_SCHEMA }) as object
			}
		});
		const data: Record<string, any> = { ...fmRaw };

		// OFM text phase
		const text = ofmTextTransform(content);

		// tags first so the inline-#tag plugin can append (fork order: FrontMatter -> AutoTag -> ... -> OFM)
		const fmTags = coerceToArray(coalesceAliases(data, ['tags', 'tag']));
		let tags: string[] = fmTags ? [...new Set(fmTags.map((tag) => slugTag(tag)))] : [];
		// AutoTag (fork ran it right after FrontMatter, before OFM appends inline tags)
		tags = applyAutoTags(tags, file.rel);

		const aliases = coerceToArray(coalesceAliases(data, ['aliases', 'alias']));
		if (aliases && aliases.length > 0) {
			warn(
				`${file.rel}: frontmatter aliases present but alias redirects are not emitted: ${aliases.join(', ')}`
			);
		}

		const modified = coalesceAliases(data, ['modified', 'lastmod', 'updated', 'last-modified']);
		if (modified) data.modified = modified;
		const published = coalesceAliases(data, ['published', 'publishDate']);
		if (published) data.published = published;

		const ofmData: OfmFileData = { slug: file.slug, tags };

		// markdown phase — plugin order mirrors quartz.config.ts transformer order
		// TOC is collected at the hast stage AFTER rehype-raw + rehype-slug so that
		// entry slugs always equal the final rendered heading ids. (Quartz slugged
		// the mdast text instead, which diverges when a heading contains raw-HTML-
		// looking tokens — e.g. `ArrayList<Partition>` in fa24-cs300/p06 — producing
		// a TOC anchor broken on the live site. Deliberate fix-not-replicate;
		// handleMissingId:'fail' enforces it corpus-wide.)
		const toc: TocEntry[] = [];
		const collectToc = () => (tree: HtmlRoot) => {
			let highestDepth = 6;
			const entries: TocEntry[] = [];
			visit(tree, 'element', (node: Element) => {
				const m = /^h([1-6])$/.exec(node.tagName);
				if (m && typeof node.properties?.id === 'string') {
					const depth = Number(m[1]);
					highestDepth = Math.min(highestDepth, depth);
					entries.push({ depth, text: hastToString(node), slug: node.properties.id });
				}
			});
			if (entries.length > 1) {
				toc.push(...entries.map((e) => ({ ...e, depth: e.depth - highestDepth })));
			}
		};

		let description = '';
		const captureDescription = () => (tree: HtmlRoot) => {
			description = computeDescription(tree, data.description as string | undefined);
		};

		const hl = await getHighlighter();
		const processor = unified()
			.use(remarkParse)
			// syntax-extension-only plugins (position in chain irrelevant, parse-time)
			.use(remarkGfm)
			.use(remarkMath)
			.use(() => preserveCurrency(text))
			// OFM mdast phase (fork order)
			.use(() => ofmReplacements(ofmData))
			.use(() => ofmVideoEmbed())
			.use(() => ofmCallouts())
			.use(() => ofmMermaid(ofmData))
			.use(remarkSmartypants)
			.use(remarkRehype, { allowDangerousHtml: true })
			.use(rehypeRaw)
			.use(() => ofmBlockReferences(ofmData))
			.use(() => ofmYouTubeEmbed())
			.use(rehypeSlug)
			.use(collectToc)
			.use(() => rehypeShiki(hl))
			.use(captureDescription)
			.use(rehypeKatex, { output: 'html', macros: {} });

		const mdast = processor.parse(text) as MdRoot;

		let heading: string | undefined;
		visit(mdast, 'heading', (node) => {
			if (node.depth === 1 && !heading) heading = mdastToString(node).trim() || undefined;
		});
		let title: string;
		if (data.title != null && String(data.title) !== '') {
			title = String(data.title);
		} else {
			const stem = path.basename(file.rel, '.md');
			const keepFilename = stem.toLowerCase().includes('readme');
			title = (keepFilename ? stem : heading) ?? stem ?? 'Untitled';
		}
		data.title = title;

		const tree = (await processor.run(mdast)) as HtmlRoot;

		const fullText = hastToString(tree);
		const wordCount = fullText.split(/\s+/).filter((w) => w.length > 0).length;

		const page: PageParse = {
			markdown: content,
			slug: file.slug,
			rel: file.rel,
			frontmatter: data as PageParse['frontmatter'],
			heading,
			title,
			description,
			tags: ofmData.tags,
			toc,
			draft: data.draft === true || data.draft === 'true',
			hasMermaid: ofmData.hasMermaidDiagram ?? false,
			wordCount,
			blocks: ofmData.blocks ?? {},
			tree
		};

		fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
		writeChanged(cacheFile, JSON.stringify(page));
		return page;
	}

	// ---------------------------------------------------------------------------
	// stage 2 — resolve (global)
	// ---------------------------------------------------------------------------

	// vendored from quartz CrawlLinks' use of is-absolute-url
	function isAbsoluteUrl(url: string): boolean {
		if (/^[a-zA-Z][a-zA-Z\d+\-.]*?:/.test(url)) {
			const windowsPath = /^[a-zA-Z]:\\/;
			if (windowsPath.test(url)) return false;
			return true;
		}
		return false;
	}

	const EXTERNAL_ICON: ElementContent = {
		type: 'element',
		tagName: 'svg',
		properties: {
			'aria-hidden': 'true',
			class: 'external-icon',
			style: 'max-width:0.8em;max-height:0.8em',
			viewBox: '0 0 512 512'
		},
		children: [
			{
				type: 'element',
				tagName: 'path',
				properties: {
					d: 'M320 0H288V64h32 82.7L201.4 265.4 178.7 288 224 333.3l22.6-22.6L448 109.3V192v32h64V192 32 0H480 320zM32 32H0V64 480v32H32 456h32V480 352 320H424v32 96H64V96h96 32V32H160 32z'
				},
				children: []
			}
		]
	};

	/** Vendored CrawlLinks visitor (quartz/plugins/transformers/links.ts) with the
	 * config used in quartz.config.ts: markdownLinkResolution "shortest",
	 * prettyLinks true, openLinksInNewTab false, lazyLoad false, externalLinkIcon true. */
	function crawlLinks(
		page: PageParse,
		transformOptions: TransformOptions,
		emittedSlugs: Set<string>,
		droppedSlugs: Set<string>
	): SimpleSlug[] {
		const curSlug = simplifySlug(page.slug);
		const outgoing: Set<SimpleSlug> = new Set();

		visit(page.tree, 'element', (node) => {
			if (node.tagName === 'a' && node.properties && typeof node.properties.href === 'string') {
				let dest = node.properties.href as RelativeURL;
				const classes = (node.properties.className ?? []) as string[];
				const isExternal = isAbsoluteUrl(dest);
				classes.push(isExternal ? 'external' : 'internal');

				if (isExternal) {
					node.children.push(structuredClone(EXTERNAL_ICON));
				}

				// Check if the link has alias text
				if (
					node.children.length === 1 &&
					node.children[0].type === 'text' &&
					node.children[0].value !== dest
				) {
					classes.push('alias');
				}
				node.properties.className = classes;

				// don't process external links or intra-document anchors
				const isInternal = !(isAbsoluteUrl(dest) || dest.startsWith('#'));
				if (isInternal) {
					dest = node.properties.href = transformLink(page.slug, dest, transformOptions);

					const url = new URL(dest, 'https://base.com/' + stripSlashes(curSlug, true));
					const canonicalDest = url.pathname;
					let [destCanonical, _destAnchor] = splitAnchor(canonicalDest);
					if (destCanonical.endsWith('/')) {
						destCanonical += 'index';
					}
					const full = decodeURIComponent(stripSlashes(destCanonical, true)) as FullSlug;
					const simple = simplifySlug(full);
					outgoing.add(simple);
					node.properties['data-slug'] = full;

					// broken-link audit (build artifact only; quartz had no equivalent)
					if (!emittedSlugs.has(full) && !emittedSlugs.has(joinSegments(full, 'index'))) {
						if (droppedSlugs.has(full)) {
							warn(
								`link-to-dropped-file: ${page.rel} -> "${dest}" (target "${full}" excluded by whitelist — review!)`
							);
						} else {
							warn(
								`broken link (also broken on live site): ${page.rel} -> "${dest}" (resolved to "${full}")`
							);
						}
					}
				}

				// rewrite link internals if prettylinks is on
				if (
					isInternal &&
					node.children.length === 1 &&
					node.children[0].type === 'text' &&
					!node.children[0].value.startsWith('#')
				) {
					node.children[0].value = path.basename(node.children[0].value);
				}
			}

			// transform all other resources that may use links
			if (
				['img', 'video', 'audio', 'iframe'].includes(node.tagName) &&
				node.properties &&
				typeof node.properties.src === 'string'
			) {
				if (!isAbsoluteUrl(node.properties.src)) {
					let dest = node.properties.src as RelativeURL;
					dest = node.properties.src = transformLink(page.slug, dest, transformOptions);
					node.properties.src = dest;

					const url = new URL(dest, 'https://base.com/' + stripSlashes(curSlug, true));
					const full = decodeURIComponent(stripSlashes(url.pathname, true));
					if (!emittedSlugs.has(full)) {
						if (droppedSlugs.has(full)) {
							warn(
								`asset-ref-to-dropped-file: ${page.rel} -> "${dest}" (target "${full}" excluded by whitelist — review!)`
							);
						} else {
							warn(`broken asset ref: ${page.rel} -> "${dest}" (resolved to "${full}")`);
						}
					}
				}
			}
		});

		return [...outgoing];
	}

	const headerRegex = new RegExp(/h[1-6]/);

	/** Vendored transclusion inliner (quartz/components/renderPage.tsx
	 * renderTranscludes), run at build time, depth-limited (<=3, quartz recursed
	 * unboundedly via unist-util-visit's natural re-traversal). */
	function inlineTranscludes(
		root: HtmlRoot,
		slug: FullSlug,
		pagesBySlug: Map<string, PageParse>,
		depth: number,
		rel: string
	) {
		if (depth > 3) return;
		visit(root, 'element', (node): typeof SKIP_VISIT | undefined => {
			if (node.tagName !== 'blockquote') return;
			const classNames = (node.properties?.className ?? []) as string[];
			if (!classNames.includes('transclude')) return;

			const inner = node.children[0] as Element;
			// already-expanded blockquotes no longer have the inner transclude anchor
			if (!inner || inner.type !== 'element' || !inner.properties?.['data-slug']) return SKIP_VISIT;
			const transcludeTarget = inner.properties['data-slug'] as FullSlug;
			const page = pagesBySlug.get(transcludeTarget);
			if (!page) {
				warn(`transclude target not found: ${rel} -> ${transcludeTarget}`);
				return SKIP_VISIT;
			}
			if (transcludeTarget === slug) {
				warn(`self-transclusion skipped: ${rel}`);
				return SKIP_VISIT;
			}

			let blockRef = node.properties?.dataBlock as string | undefined;
			if (blockRef?.startsWith('#^')) {
				// block transclude
				blockRef = blockRef.slice('#^'.length);
				let blockNode = page.blocks?.[blockRef];
				if (blockNode) {
					if (blockNode.tagName === 'li') {
						blockNode = { type: 'element', tagName: 'ul', properties: {}, children: [blockNode] };
					}
					node.children = [
						normalizeHastElement(blockNode, slug, transcludeTarget),
						linkToOriginal(inner)
					];
				}
			} else if (blockRef?.startsWith('#') && page.tree) {
				// header transclude
				blockRef = blockRef.slice(1);
				let startIdx: number | undefined = undefined;
				let startDepth: number | undefined = undefined;
				let endIdx: number | undefined = undefined;
				for (const [i, el] of page.tree.children.entries()) {
					if (!(el.type === 'element' && el.tagName.match(headerRegex))) continue;
					const depth_ = Number(el.tagName.substring(1));
					if (startIdx === undefined || startDepth === undefined) {
						if (el.properties?.id === blockRef) {
							startIdx = i;
							startDepth = depth_;
						}
					} else if (depth_ <= startDepth) {
						endIdx = i;
						break;
					}
				}
				if (startIdx === undefined) {
					warn(`transclude header not found: ${rel} -> ${transcludeTarget}#${blockRef}`);
					return;
				}
				node.children = [
					...(page.tree.children.slice(startIdx, endIdx) as ElementContent[]).map((child) =>
						normalizeHastElement(child as Element, slug, transcludeTarget)
					),
					linkToOriginal(inner)
				];
			} else if (page.tree) {
				// page transclude
				node.children = [
					{
						type: 'element',
						tagName: 'h1',
						properties: {},
						children: [
							{
								type: 'text',
								value: page.frontmatter?.title ?? `Transclude of ${page.slug}`
							}
						]
					},
					...(page.tree.children as ElementContent[]).map((child) =>
						normalizeHastElement(child as Element, slug, transcludeTarget)
					),
					linkToOriginal(inner)
				];
			}

			// nested transcludes inside the inlined content (explicit recursion with
			// depth accounting; SKIP stops the outer traversal from re-descending)
			inlineTranscludes(
				{ type: 'root', children: node.children } as HtmlRoot,
				slug,
				pagesBySlug,
				depth + 1,
				rel
			);
			return SKIP_VISIT;
		});
	}

	function linkToOriginal(inner: Element): ElementContent {
		return {
			type: 'element',
			tagName: 'a',
			properties: { href: inner.properties?.href, class: ['internal', 'transclude-src'] },
			children: [{ type: 'text', value: 'Link to original' }]
		};
	}

	/**
	 * DIVERGENCE from Quartz: canonicalize relative hrefs/srcs to root-absolute.
	 * Browser-equivalent to Quartz's relative URLs, but stable under
	 * trailingSlash:'never' (folder pages lose their trailing slash in SvelteKit).
	 */
	function absolutizeUrls(tree: HtmlRoot, slug: FullSlug) {
		const simple = simplifySlug(slug);
		const base = 'https://base.com/' + (simple === '/' ? '' : stripSlashes(simple, true));
		const fix = (val: string): string => {
			if (isAbsoluteUrl(val) || val.startsWith('#') || val.startsWith('data:')) return val;
			const url = new URL(val, base);
			let p = url.pathname;
			if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1); // trailingSlash: never
			return p + url.hash;
		};
		visit(tree, 'element', (node) => {
			if (typeof node.properties?.href === 'string')
				node.properties.href = fix(node.properties.href);
			if (typeof node.properties?.src === 'string' && !node.properties.src.startsWith('data:'))
				node.properties.src = fix(node.properties.src);
		});
	}

	// ---------------------------------------------------------------------------
	// stage 3 — emit
	// ---------------------------------------------------------------------------
	interface NavNode {
		name: string;
		slug: string; // folder simple slug, e.g. "sp26-cs537/p1"
		title: string;
		children: NavNode[];
		pages: { slug: string; title: string }[];
	}

	function buildTree(pages: PageParse[]): NavNode {
		const root: NavNode = { name: '', slug: '', title: 'wisconsin', children: [], pages: [] };
		const dirOf = (slug: string) => slug.split('/').slice(0, -1).join('/');
		const folderNode = (dir: string): NavNode => {
			if (dir === '') return root;
			const parts = dir.split('/');
			let cur = root;
			let acc: string[] = [];
			for (const part of parts) {
				acc.push(part);
				let next = cur.children.find((c) => c.name === part);
				if (!next) {
					next = { name: part, slug: acc.join('/'), title: part, children: [], pages: [] };
					cur.children.push(next);
				}
				cur = next;
			}
			return cur;
		};
		for (const page of pages) {
			const dir = dirOf(page.slug);
			const node = folderNode(dir);
			if (page.slug.split('/').pop() === 'index') {
				node.title = page.title; // folder with its own index page
			}
			node.pages.push({ slug: page.slug, title: page.title });
		}
		const sortNode = (n: NavNode) => {
			n.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
			n.pages.sort((a, b) => a.slug.localeCompare(b.slug, undefined, { numeric: true }));
			n.children.forEach(sortNode);
		};
		sortNode(root);
		return root;
	}

	async function main() {
		const t0 = performance.now();
		fs.mkdirSync(OUT_DIR, { recursive: true });
		fs.mkdirSync(CACHE_DIR, { recursive: true });
		const wantedPages = new Set<string>();
		const wantedAssets = new Set<string>();
		fs.mkdirSync(path.join(OUT_DIR, 'assets'), { recursive: true });

		// stage 0
		const { files: discovered } = discover();
		const publicationFor = publicationResolver(REPO_ROOT);
		const licenseFor = courseLicenseResolver(REPO_ROOT);
		const files = publicEdition
			? discovered.filter((file) => publicationFor(file.rel).public)
			: discovered;
		const pagesSrc = discovered.filter((f) => f.kind === 'page');
		const assetsSrc = files.filter((f) => f.kind === 'asset');
		const otherSrc = files.filter((f) => f.kind === 'other');
		console.log(
			`discover: ${files.length} tracked+visible files — ${pagesSrc.length} md, ${assetsSrc.length} whitelisted assets, ${otherSrc.length} dropped`
		);

		// resolution slug set = "**/*.*"-visible files only (matches quartz ctx.allSlugs;
		// extensionless served files are deliberately NOT in it, same as quartz)
		const allSlugs = discovered.filter((f) => f.inResolution).map((f) => f.slug);

		// git dates (one batched walk per submodule, HEAD-keyed cache)
		const tDates = performance.now();
		const gitDates = buildGitDateMap(REPO_ROOT, CACHE_DIR);
		console.log(
			`git dates: ${Object.keys(gitDates.modified).length} paths in ${Math.round(performance.now() - tDates)}ms`
		);

		// stage 1
		const t1 = performance.now();
		const parses: PageParse[] = [];
		for (const f of pagesSrc) {
			try {
				parses.push(await parsePage(f));
			} catch (e) {
				console.error(`PARSE FAILED: ${f.rel}`);
				throw e;
			}
		}
		console.log(`parse: ${parses.length} pages in ${Math.round(performance.now() - t1)}ms`);

		const drafts = parses.filter((p) => p.draft);
		const catalog = parses.filter((p) => !p.draft);
		const lockedPages = publicEdition
			? catalog.filter((page) => !publicationFor(page.rel).public)
			: [];
		const pages = publicEdition
			? catalog.filter((page) => publicationFor(page.rel).public)
			: catalog;
		if (drafts.length > 0) {
			console.log(`drafts skipped: ${drafts.length} (${drafts.map((d) => d.rel).join(', ')})`);
		}

		// stage 2
		const t2 = performance.now();
		const transformOptions: TransformOptions = { strategy: 'shortest', allSlugs };
		// emitted output set for broken-link audit: pages + assets + folder pages + tag pages
		const pageSlugSet = new Set<string>(pages.map((p) => p.slug as string));
		const folderSet = new Set<string>();
		for (const p of pages) {
			const parts = (p.slug as string).split('/');
			for (let i = 1; i < parts.length; i++) {
				folderSet.add(parts.slice(0, i).join('/'));
			}
		}
		const allTags = new Set<string>(catalog.flatMap((p) => p.tags.flatMap(getAllSegmentPrefixes)));
		const emittedSlugs = new Set<string>([
			...pageSlugSet,
			...assetsSrc.map((a) => a.slug as string),
			...folderSet, // folder pages (route serves /<dir>)
			...[...folderSet].map((f) => `${f}/index`),
			...[...allTags].map((t) => `tags/${t}`),
			'index',
			'tags',
			'tags/index'
		]);

		const droppedSlugs = new Set<string>(otherSrc.map((f) => f.slug as string));
		const catalogSlugs = new Set([...emittedSlugs, ...catalog.map((page) => page.slug as string)]);
		const outgoingBySlug = new Map<string, SimpleSlug[]>();
		for (const page of catalog) {
			const outgoing = crawlLinks(page, transformOptions, catalogSlugs, droppedSlugs);
			if (publicEdition && publicationFor(page.rel).public)
				protectPublicLinks(page.tree, page.slug, emittedSlugs, catalogSlugs);
			outgoingBySlug.set(page.slug, outgoing);
		}

		// tag pages exist for every tag (incl. hierarchical prefixes) — add them to
		// the emitted set retroactively for the link audit? (tag links are generated
		// by the pipeline itself and always valid, so nothing to do)

		// transclusions (after link resolution, mirrors quartz render order)
		const pagesBySlug = new Map<string, PageParse>(pages.map((p) => [p.slug as string, p]));
		for (const page of pages) {
			inlineTranscludes(page.tree, page.slug, pagesBySlug, 1, page.rel);
		}

		// backlinks (simple-slug space, like quartz)
		const backlinks = new Map<string, Set<string>>();
		for (const page of pages) {
			const fromSimple = simplifySlug(page.slug);
			for (const out of outgoingBySlug.get(page.slug) ?? []) {
				if (!backlinks.has(out)) backlinks.set(out, new Set());
				backlinks.get(out)!.add(fromSimple);
			}
		}

		// root-absolute canonicalization (divergence, see fn docstring)
		for (const page of pages) {
			absolutizeUrls(page.tree, page.slug);
		}
		console.log(`resolve: links+transcludes+backlinks in ${Math.round(performance.now() - t2)}ms`);

		// stage 3
		const t3 = performance.now();
		const sizeViolations: string[] = [];
		const checkSize = (outPath: string) => {
			const { size } = fs.statSync(outPath);
			if (size > SIZE_FAIL) {
				sizeViolations.push(
					`${outPath} is ${(size / 1024 / 1024).toFixed(1)}MiB (> 25MiB Workers cap)`
				);
			} else if (size > SIZE_WARN) {
				warn(`size: ${outPath} is ${(size / 1024 / 1024).toFixed(1)}MiB (> 20MiB warn threshold)`);
			}
		};

		// assets
		let assetBytes = 0;
		for (const asset of assetsSrc) {
			// html assets: extensionless at slug, exactly like quartz's Assets emitter
			const dest = path.join(OUT_DIR, 'assets', asset.slug);
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			copyChanged(asset.abs, dest);
			wantedAssets.add(dest);
			assetBytes += fs.statSync(dest).size;
			checkSize(dest);
		}

		// per-page JSON
		const simpleToFull = new Map<string, string>();
		for (const p of pages) simpleToFull.set(simplifySlug(p.slug), p.slug);
		const pageMeta: Record<string, unknown> = {};
		const tagIndex = new Map<string, string[]>();
		for (const page of catalog) {
			for (const tag of page.tags.flatMap(getAllSegmentPrefixes)) {
				if (!tagIndex.has(tag)) tagIndex.set(tag, []);
				if (!tagIndex.get(tag)!.includes(page.slug)) tagIndex.get(tag)!.push(page.slug);
			}
		}

		for (const page of pages) {
			const dates = resolveDates({
				relativePath: page.rel,
				frontmatter: page.frontmatter,
				gitDates,
				warn
			});
			const simple = simplifySlug(page.slug);
			const pageBacklinks = [...(backlinks.get(simple) ?? [])]
				.filter((s) => s !== simple)
				.sort()
				.map((s) => {
					const full = simpleToFull.get(s);
					const p = full ? pagesBySlug.get(full) : undefined;
					return { slug: s, title: p?.title ?? s };
				});

			const html = toHtml(page.tree, { allowDangerousHtml: true });
			const meta = {
				author: contentAuthor(page.frontmatter.author),
				license: licenseFor(page.rel),
				publication: publicEdition ? { public: true } : publicationFor(page.rel),
				slug: page.slug,
				title: page.title,
				description: page.description,
				heading: page.heading,
				tags: page.tags,
				dates: {
					created: dates.created?.toISOString() ?? '',
					modified: dates.modified?.toISOString() ?? '',
					published: dates.published?.toISOString() ?? ''
				},
				links: outgoingBySlug.get(page.slug) ?? [],
				backlinks: pageBacklinks.map((b) => b.slug),
				wordCount: page.wordCount,
				readingTime: Math.max(1, Math.ceil(page.wordCount / 200)),
				hasMermaid: page.hasMermaid,
				relativePath: page.rel
			};
			pageMeta[page.slug] = meta;

			const outPath = path.join(OUT_DIR, 'pages', page.slug + '.json');
			wantedPages.add(outPath);
			fs.mkdirSync(path.dirname(outPath), { recursive: true });
			writeChanged(
				outPath,
				JSON.stringify({
					...meta,
					toc: page.toc,
					backlinks: pageBacklinks,
					html,
					markdown: page.markdown
				})
			);
			checkSize(outPath);
		}

		for (const page of lockedPages) {
			const meta = {
				locked: true,
				publication: { public: false },
				slug: page.slug,
				title: page.title,
				description: '',
				heading: page.heading,
				tags: page.tags,
				dates: { created: '', modified: '', published: '' },
				links: [],
				backlinks: [],
				wordCount: 0,
				readingTime: 0,
				hasMermaid: false,
				relativePath: page.rel
			};
			pageMeta[page.slug] = meta;
			const outPath = path.join(OUT_DIR, 'pages', page.slug + '.json');
			wantedPages.add(outPath);
			fs.mkdirSync(path.dirname(outPath), { recursive: true });
			writeChanged(outPath, JSON.stringify({ ...meta, toc: page.toc, html: '' }));
			const parts = page.slug.split('/');
			for (let i = 1; i < parts.length; i++) folderSet.add(parts.slice(0, i).join('/'));
		}

		pruneOutputs(path.join(OUT_DIR, 'pages'), wantedPages);
		pruneOutputs(
			path.join(OUT_DIR, 'assets'),
			wantedAssets,
			(file) => file === path.join(OUT_DIR, 'assets/_files')
		);

		// manifest
		const tree = buildTree(catalog);
		const catalogNodes = new Set(catalog.map((page) => simplifySlug(page.slug)));
		const graph = {
			nodes: catalog.map((p) => ({
				id: simplifySlug(p.slug),
				title: p.title,
				tags: p.tags
			})),
			links: catalog.flatMap((p) =>
				(outgoingBySlug.get(p.slug) ?? [])
					.filter((out) => catalogNodes.has(out))
					.map((out) => ({ source: simplifySlug(p.slug), target: out }))
			)
		};
		const manifest = {
			generatedAt: new Date().toISOString(),
			counts: {
				pages: pages.length,
				drafts: drafts.length,
				assets: assetsSrc.length,
				images: assetsSrc.filter((a) =>
					IMAGE_EXTS.has((getFileExtension(a.rel) ?? '').toLowerCase())
				).length,
				pdfs: assetsSrc.filter((a) => a.rel.toLowerCase().endsWith('.pdf')).length,
				htmlAssets: assetsSrc.filter((a) => a.rel.toLowerCase().endsWith('.html')).length,
				dropped: otherSrc.length
			},
			pages: pageMeta,
			folders: [...folderSet].sort(),
			tags: Object.fromEntries(
				[...tagIndex.entries()]
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([t, slugs]) => [t, slugs.sort()])
			),
			tree,
			assets: assetsSrc.map((a) => a.slug),
			htmlAssets: assetsSrc.filter((a) => a.rel.toLowerCase().endsWith('.html')).map((a) => a.slug),
			graph
		};
		const manifestFile = path.join(OUT_DIR, 'content-manifest.json');
		if (fs.existsSync(manifestFile)) {
			const previous = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
			if (
				JSON.stringify({ ...manifest, generatedAt: previous.generatedAt }) ===
				JSON.stringify(previous)
			)
				manifest.generatedAt = previous.generatedAt;
		}
		writeChanged(manifestFile, JSON.stringify(manifest, null, 1));

		// dropped-urls.txt — tracked files the old Quartz site served but the
		// whitelist excludes.
		writeChanged(
			path.join(OUT_DIR, 'dropped-urls.txt'),
			otherSrc.map((f) => '/' + f.slug).join('\n') + '\n'
		);

		// warnings
		if (unknownLangs.size > 0) {
			warn(
				`shiki: unknown languages rendered as plaintext: ${[...unknownLangs.entries()]
					.map(([l, n]) => `${l} (${n})`)
					.join(', ')}`
			);
		}
		writeChanged(path.join(OUT_DIR, 'warnings.txt'), warnings.join('\n') + '\n');

		console.log(
			`emit: ${pages.length} page JSONs, ${assetsSrc.length} assets (${(assetBytes / 1024 / 1024).toFixed(1)}MiB) in ${Math.round(performance.now() - t3)}ms`
		);
		console.log(
			`counts: pages=${pages.length} drafts=${drafts.length} assets=${assetsSrc.length} (images=${manifest.counts.images} pdfs=${manifest.counts.pdfs} html=${manifest.counts.htmlAssets}) dropped=${otherSrc.length} tags=${tagIndex.size} folders=${folderSet.size}`
		);
		console.log(`warnings: ${warnings.length} (site/build/generated/warnings.txt)`);

		if (sizeViolations.length > 0) {
			console.error('SIZE FAILURES:\n' + sizeViolations.join('\n'));
			throw new Error('Content exceeds the deployment asset limit');
		}
		console.log(`done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
	}

	try {
		await main();
	} finally {
		highlighter?.dispose();
	}
}
