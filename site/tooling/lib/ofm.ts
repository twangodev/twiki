/**
 * Vendored from the wisconsin Quartz fork's `quartz/plugins/transformers/ofm.ts`,
 * reshaped as plain unified plugins for the standalone prebuild.
 *
 * Grammar kept verbatim: comments `%%..%%`, wikilink-in-table escapes, external-URL
 * wikilinks (text phase); wikilinks `[[x]]` / `[[x|alias]]` / `[[x#h]]`, embeds
 * `![[img|WxH]]` / `![[doc.pdf]]` / `![[note]]` (note transclusion emits the fork's
 * `<blockquote class="transclude">` placeholder, inlined in pass 2 of the prebuild),
 * callouts incl. collapsed `[!type]-` with the fork's `callout-content` /
 * `callout-content-inner` div structure, `==highlights==`, arrows, inline `#tags`
 * with the fork's numeric-tag filtering, mermaid fence marking, block references,
 * and the YouTube-image-to-iframe html-phase rewrite.
 *
 * Intentional divergences (noted inline too):
 *  - The Quartz plugin-wrapper machinery (QuartzTransformerPlugin, externalResources,
 *    inline browser scripts) is dropped; this module exports the raw plugin fns.
 *  - `enableInHtmlEmbed` was false in quartz.config.ts -> branch not ported.
 *  - `enableCheckbox` was false (default) -> branch not ported.
 *  - `disableBrokenWikilinks` was false (default) -> branch not ported.
 *  - The mermaid html-phase expand-button/container DOM is NOT emitted; the new
 *    site's Mermaid island consumes `<code class="mermaid" data-clipboard>` directly.
 *  - quartz.config.ts ran ObsidianFlavoredMarkdown twice; the second application is
 *    a no-op for the mdast plugins (syntax already consumed) and only the
 *    `calloutLineRegex` text pre-transform observably re-fires, inserting an extra
 *    empty `> ` continuation line that renders identically. We run everything once.
 */
import type {
	Root,
	Html,
	BlockContent,
	PhrasingContent,
	DefinitionContent,
	Paragraph,
	Code
} from 'mdast';
import type { Element, ElementContent, Literal, Root as HtmlRoot } from 'hast';
import {
	type ReplaceFunction,
	findAndReplace as mdastFindReplace
} from 'mdast-util-find-and-replace';
import { SKIP, visit } from 'unist-util-visit';
import path from 'node:path';
import { toHast } from 'mdast-util-to-hast';
import { toHtml } from 'hast-util-to-html';
import {
	type FilePath,
	type FullSlug,
	pathToRoot,
	slugTag,
	slugifyFilePath,
	splitAnchor
} from './slug';

const calloutMapping = {
	note: 'note',
	abstract: 'abstract',
	summary: 'abstract',
	tldr: 'abstract',
	info: 'info',
	todo: 'todo',
	tip: 'tip',
	hint: 'tip',
	important: 'tip',
	success: 'success',
	check: 'success',
	done: 'success',
	question: 'question',
	help: 'question',
	faq: 'question',
	warning: 'warning',
	attention: 'warning',
	caution: 'warning',
	failure: 'failure',
	missing: 'failure',
	fail: 'failure',
	danger: 'danger',
	error: 'danger',
	bug: 'bug',
	example: 'example',
	quote: 'quote',
	cite: 'quote'
} as const;

const arrowMapping: Record<string, string> = {
	'->': '&rarr;',
	'-->': '&rArr;',
	'=>': '&rArr;',
	'==>': '&rArr;',
	'<-': '&larr;',
	'<--': '&lArr;',
	'<=': '&lArr;',
	'<==': '&lArr;'
};

// from quartz/util/lang.ts
function capitalize(s: string): string {
	return s.substring(0, 1).toUpperCase() + s.substring(1);
}

function canonicalizeCallout(calloutName: string): keyof typeof calloutMapping {
	const normalizedCallout = calloutName.toLowerCase() as keyof typeof calloutMapping;
	// if callout is not recognized, make it a custom one
	return calloutMapping[normalizedCallout] ?? calloutName;
}

export const externalLinkRegex = /^https?:\/\//i;

export const arrowRegex = new RegExp(/(-{1,2}>|={1,2}>|<-{1,2}|<={1,2})/g);

// !?                 -> optional embedding
// \[\[               -> open brace
// ([^\[\]\|\#]+)     -> one or more non-special characters ([,],|, or #) (name)
// (#[^\[\]\|\#]+)?   -> # then one or more non-special characters (heading link)
// (\\?\|[^\[\]\#]+)? -> optional escape \ then | then zero or more non-special characters (alias)
export const wikilinkRegex = new RegExp(
	/!?\[\[([^\[\]\|\#\\]+)?(#+[^\[\]\|\#\\]+)?(\\?\|[^\[\]\#]*)?\]\]/g
);

// ^\|([^\n])+\|\n(\|) -> matches the header row
// ( ?:?-{3,}:? ?\|)+  -> matches the header row separator
// (\|([^\n])+\|\n)+   -> matches the body rows
export const tableRegex = new RegExp(/^\|([^\n])+\|\n(\|)( ?:?-{3,}:? ?\|)+\n(\|([^\n])+\|\n?)+/gm);

// matches any wikilink, only used for escaping wikilinks inside tables
export const tableWikilinkRegex = new RegExp(/(!?\[\[[^\]]*?\]\]|\[\^[^\]]*?\])/g);

const highlightRegex = new RegExp(/==([^=]+)==/g);
const commentRegex = new RegExp(/%%[\s\S]*?%%/g);
// from https://github.com/escwxyz/remark-obsidian-callout/blob/main/src/index.ts
const calloutRegex = new RegExp(/^\[\!([\w-]+)\|?(.+?)?\]([+-]?)/);
const calloutLineRegex = new RegExp(/^> *\[\!\w+\|?.*?\][+-]?.*$/gm);
// (?<=^| )             -> a lookbehind assertion, tag should start be separated by a space or be the start of the line
// #(...)               -> capturing group, tag itself must start with #
// (?:[-_\p{L}\d\p{Z}])+       -> non-capturing group, non-empty string of (Unicode-aware) alpha-numeric characters and symbols, hyphens and/or underscores
// (?:\/[-_\p{L}\d\p{Z}]+)*)   -> non-capturing group, matches an arbitrary number of tag strings separated by "/"
const tagRegex = new RegExp(
	/(?<=^| )#((?:[-_\p{L}\p{Emoji}\p{M}\d])+(?:\/[-_\p{L}\p{Emoji}\p{M}\d]+)*)/gu
);
const blockReferenceRegex = new RegExp(/\^([-_A-Za-z0-9]+)$/g);
const ytLinkRegex = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
const ytPlaylistLinkRegex = /[?&]list=([^#?&]*)/;
const videoExtensionRegex = new RegExp(/\.(mp4|webm|ogg|avi|mov|flv|wmv|mkv|mpg|mpeg|3gp|m4v)$/);
const wikilinkImageEmbedRegex = new RegExp(
	/^(?<alt>(?!^\d*x?\d*$).*?)?(\|?\s*?(?<width>\d+)(x(?<height>\d+))?)?$/
);

const mdastToHtml = (ast: PhrasingContent | Paragraph) => {
	const hast = toHast(ast, { allowDangerousHtml: true })!;
	return toHtml(hast, { allowDangerousHtml: true });
};

/** Per-file context threaded through the mdast plugins (replaces vfile.data). */
export interface OfmFileData {
	slug: FullSlug;
	/** mutated in place: inline #tags get appended (slugged, deduped) */
	tags: string[];
	hasMermaidDiagram?: boolean;
	/** block id -> hast element, collected by the block-reference html plugin */
	blocks?: Record<string, Element>;
	htmlAst?: HtmlRoot;
}

// ---------------------------------------------------------------------------
// text phase (fork's textTransform, applied to raw markdown after frontmatter)
// ---------------------------------------------------------------------------
export function ofmTextTransform(src: string): string {
	// do comments at text level
	src = src.replace(commentRegex, '');

	// pre-transform blockquotes
	src = src.replace(calloutLineRegex, (value) => {
		// force newline after title of callout
		return value + '\n> ';
	});

	// pre-transform wikilinks (fix anchors to things that may contain illegal syntax e.g. codeblocks, latex)
	// replace all wikilinks inside a table first
	src = src.replace(tableRegex, (value) => {
		// escape all aliases and headers in wikilinks inside a table
		return value.replace(tableWikilinkRegex, (_value, raw) => {
			let escaped = raw ?? '';
			escaped = escaped.replace('#', '\\#');
			// escape pipe characters if they are not already escaped
			escaped = escaped.replace(/((^|[^\\])(\\\\)*)\|/g, '$1\\|');

			return escaped;
		});
	});

	// replace all other wikilinks
	src = src.replace(wikilinkRegex, (value, ...capture) => {
		const [rawFp, rawHeader, rawAlias]: (string | undefined)[] = capture;

		const [fp, anchor] = splitAnchor(`${rawFp ?? ''}${rawHeader ?? ''}`);
		const blockRef = Boolean(rawHeader?.startsWith('#^')) ? '^' : '';
		const displayAnchor = anchor ? `#${blockRef}${anchor.trim().replace(/^#+/, '')}` : '';
		const displayAlias = rawAlias ?? rawHeader?.replace('#', '|') ?? '';
		const embedDisplay = value.startsWith('!') ? '!' : '';

		if (rawFp?.match(externalLinkRegex)) {
			return `${embedDisplay}[${displayAlias.replace(/^\|/, '')}](${rawFp})`;
		}

		return `${embedDisplay}[[${fp}${displayAnchor}${displayAlias}]]`;
	});

	return src;
}

// ---------------------------------------------------------------------------
// mdast phase
// ---------------------------------------------------------------------------

/** wikilinks/embeds, ==highlights==, arrows, inline #tags (fork's regex-replacement plugin) */
export function ofmReplacements(data: OfmFileData) {
	return (tree: Root) => {
		const replacements: [RegExp, string | ReplaceFunction][] = [];
		const base = pathToRoot(data.slug);

		// wikilinks
		replacements.push([
			wikilinkRegex,
			(value: string, ...capture: string[]) => {
				let [rawFp, rawHeader, rawAlias] = capture;
				const fp = rawFp?.trim() ?? '';
				const anchor = rawHeader?.trim() ?? '';
				const alias: string | undefined = rawAlias?.slice(1).trim();

				// embed cases
				if (value.startsWith('!')) {
					const ext: string = path.extname(fp).toLowerCase();
					const url = slugifyFilePath(fp as FilePath);
					if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp'].includes(ext)) {
						const match = wikilinkImageEmbedRegex.exec(alias ?? '');
						const alt = match?.groups?.alt ?? '';
						const width = match?.groups?.width ?? 'auto';
						const height = match?.groups?.height ?? 'auto';
						return {
							type: 'image',
							url,
							data: {
								hProperties: {
									width,
									height,
									alt
								}
							}
						};
					} else if (['.mp4', '.webm', '.ogv', '.mov', '.mkv'].includes(ext)) {
						return {
							type: 'html',
							value: `<video src="${url}" controls></video>`
						};
					} else if (['.mp3', '.webm', '.wav', '.m4a', '.ogg', '.3gp', '.flac'].includes(ext)) {
						return {
							type: 'html',
							value: `<audio src="${url}" controls></audio>`
						};
					} else if (['.pdf'].includes(ext)) {
						return {
							type: 'html',
							value: `<iframe src="${url}" class="pdf"></iframe>`
						};
					} else {
						// note transclusion: emit the fork's placeholder blockquote; the
						// prebuild's pass 2 inlines it (replaces Quartz's renderPage hack)
						const block = anchor;
						return {
							type: 'html',
							data: { hProperties: { transclude: true } },
							value: `<blockquote class="transclude" data-url="${url}" data-block="${block}" data-embed-alias="${alias}"><a href="${
								url + anchor
							}" class="transclude-inner">Transclude of ${url}${block}</a></blockquote>`
						};
					}

					// otherwise, fall through to regular link
				}

				// internal link
				const url = fp + anchor;

				return {
					type: 'link',
					url,
					children: [
						{
							type: 'text',
							value: alias ?? fp
						}
					]
				};
			}
		]);

		// ==highlights==
		replacements.push([
			highlightRegex,
			(_value: string, ...capture: string[]) => {
				const [inner] = capture;
				return {
					type: 'html',
					value: `<span class="text-highlight">${inner}</span>`
				};
			}
		]);

		// arrows
		replacements.push([
			arrowRegex,
			(value: string, ..._capture: string[]) => {
				const maybeArrow = arrowMapping[value];
				if (maybeArrow === undefined) return SKIP;
				return {
					type: 'html',
					value: `<span>${maybeArrow}</span>`
				};
			}
		]);

		// inline #tags
		replacements.push([
			tagRegex,
			(_value: string, tag: string) => {
				// Check if the tag only includes numbers and slashes
				if (/^[\/\d]+$/.test(tag)) {
					return false;
				}

				tag = slugTag(tag);
				if (!data.tags.includes(tag)) {
					data.tags.push(tag);
				}

				return {
					type: 'link',
					url: base + `/tags/${tag}`,
					data: {
						hProperties: {
							className: ['tag-link']
						}
					},
					children: [
						{
							type: 'text',
							value: tag
						}
					]
				};
			}
		]);

		mdastFindReplace(tree, replacements);
	};
}

/** ![[video.mp4]] markdown-image-with-video-extension -> <video> (enableVideoEmbed) */
export function ofmVideoEmbed() {
	return (tree: Root) => {
		visit(tree, 'image', (node, index, parent) => {
			if (parent && index != undefined && videoExtensionRegex.test(node.url)) {
				const newNode: Html = {
					type: 'html',
					value: `<video controls src="${node.url}"></video>`
				};

				parent.children.splice(index, 1, newNode);
				return SKIP;
			}
		});
	};
}

/** callouts incl. collapsed [!type]- with the fork's callout-content div structure */
export function ofmCallouts() {
	return (tree: Root) => {
		visit(tree, 'blockquote', (node) => {
			if (node.children.length === 0) {
				return;
			}

			// find first line and callout content
			const [firstChild, ...calloutContent] = node.children;
			if (firstChild.type !== 'paragraph' || firstChild.children[0]?.type !== 'text') {
				return;
			}

			const text = firstChild.children[0].value;
			const restOfTitle = firstChild.children.slice(1);
			const [firstLine, ...remainingLines] = text.split('\n');
			const remainingText = remainingLines.join('\n');

			const match = firstLine.match(calloutRegex);
			if (match && match.input) {
				const [calloutDirective, typeString, calloutMetaData, collapseChar] = match;
				const calloutType = canonicalizeCallout(typeString.toLowerCase());
				const collapse = collapseChar === '+' || collapseChar === '-';
				const defaultState = collapseChar === '-' ? 'collapsed' : 'expanded';
				const titleContent = match.input.slice(calloutDirective.length).trim();
				const useDefaultTitle = titleContent === '' && restOfTitle.length === 0;
				const titleNode: Paragraph = {
					type: 'paragraph',
					children: [
						{
							type: 'text',
							value: useDefaultTitle
								? capitalize(typeString).replace(/-/g, ' ')
								: titleContent + ' '
						},
						...restOfTitle
					]
				};
				const title = mdastToHtml(titleNode);

				const toggleIcon = `<div class="fold-callout-icon"></div>`;

				const titleHtml: Html = {
					type: 'html',
					value: `<div
                  class="callout-title"
                >
                  <div class="callout-icon"></div>
                  <div class="callout-title-inner">${title}</div>
                  ${collapse ? toggleIcon : ''}
                </div>`
				};

				const blockquoteContent: (BlockContent | DefinitionContent)[] = [titleHtml];
				if (remainingText.length > 0) {
					blockquoteContent.push({
						type: 'paragraph',
						children: [
							{
								type: 'text',
								value: remainingText
							}
						]
					});
				}

				// For the rest of the MD callout elements other than the title, wrap them with
				// two nested HTML <div>s (use some hacked mdhast component to achieve this) of
				// class `callout-content` and `callout-content-inner` respectively for
				// grid-based collapsible animation.
				if (calloutContent.length > 0) {
					node.children = [
						node.children[0],
						{
							data: { hProperties: { className: ['callout-content'] }, hName: 'div' },
							type: 'blockquote',
							children: [
								{
									data: {
										hProperties: { className: ['callout-content-inner'] },
										hName: 'div'
									},
									type: 'blockquote',
									children: [...calloutContent]
								}
							]
						}
					];
				}

				// replace first line of blockquote with title and rest of the paragraph text
				node.children.splice(0, 1, ...blockquoteContent);

				const classNames = ['callout', calloutType];
				if (collapse) {
					classNames.push('is-collapsible');
				}
				if (defaultState === 'collapsed') {
					classNames.push('is-collapsed');
				}

				// add properties to base blockquote
				node.data = {
					hProperties: {
						...(node.data?.hProperties ?? {}),
						className: classNames.join(' '),
						'data-callout': calloutType,
						'data-callout-fold': collapse,
						'data-callout-metadata': calloutMetaData
					}
				};
			}
		});
	};
}

/** mark ```mermaid fences for the client island */
export function ofmMermaid(data: OfmFileData) {
	return (tree: Root) => {
		visit(tree, 'code', (node: Code) => {
			if (node.lang === 'mermaid') {
				data.hasMermaidDiagram = true;
				node.data = {
					hProperties: {
						className: ['mermaid'],
						'data-clipboard': JSON.stringify(node.value)
					}
				};
			}
		});
	};
}

// ---------------------------------------------------------------------------
// hast phase
// ---------------------------------------------------------------------------

/** block references `^id` (parseBlockReferences) — collects data.blocks + htmlAst */
export function ofmBlockReferences(data: OfmFileData) {
	const inlineTagTypes = new Set(['p', 'li']);
	const blockTagTypes = new Set(['blockquote']);
	return (tree: HtmlRoot) => {
		data.blocks = {};

		visit(tree, 'element', (node, index, parent) => {
			if (blockTagTypes.has(node.tagName)) {
				const nextChild = parent?.children.at(index! + 2) as Element;
				if (nextChild && nextChild.tagName === 'p') {
					const text = nextChild.children.at(0) as Literal;
					if (text && text.value && text.type === 'text') {
						const matches = text.value.match(blockReferenceRegex);
						if (matches && matches.length >= 1) {
							parent!.children.splice(index! + 2, 1);
							const block = matches[0].slice(1);

							if (!Object.keys(data.blocks!).includes(block)) {
								node.properties = {
									...node.properties,
									id: block
								};
								data.blocks![block] = node;
							}
						}
					}
				}
			} else if (inlineTagTypes.has(node.tagName)) {
				const last = node.children.at(-1) as Literal;
				if (last && last.value && typeof last.value === 'string') {
					const matches = last.value.match(blockReferenceRegex);
					if (matches && matches.length >= 1) {
						last.value = last.value.slice(0, -matches[0].length);
						const block = matches[0].slice(1);

						if (last.value === '') {
							// this is an inline block ref but the actual block
							// is the previous element above it
							let idx = (index ?? 1) - 1;
							while (idx >= 0) {
								const element = parent?.children.at(idx);
								if (!element) break;
								if (element.type !== 'element') {
									idx -= 1;
								} else {
									if (!Object.keys(data.blocks!).includes(block)) {
										element.properties = {
											...element.properties,
											id: block
										};
										data.blocks![block] = element;
									}
									return;
								}
							}
						} else {
							// normal paragraph transclude
							if (!Object.keys(data.blocks!).includes(block)) {
								node.properties = {
									...node.properties,
									id: block
								};
								data.blocks![block] = node;
							}
						}
					}
				}
			}
		});

		data.htmlAst = tree;
	};
}

/** ![](youtube url) image -> embedded iframe (enableYouTubeEmbed) */
export function ofmYouTubeEmbed() {
	return (tree: HtmlRoot) => {
		visit(tree, 'element', (node) => {
			if (node.tagName === 'img' && typeof node.properties.src === 'string') {
				const match = node.properties.src.match(ytLinkRegex);
				const videoId = match && match[2].length == 11 ? match[2] : null;
				const playlistId = node.properties.src.match(ytPlaylistLinkRegex)?.[1];
				if (videoId) {
					// YouTube video (with optional playlist)
					node.tagName = 'iframe';
					node.properties = {
						class: 'external-embed youtube',
						allow: 'fullscreen',
						frameborder: 0,
						width: '600px',
						src: playlistId
							? `https://www.youtube.com/embed/${videoId}?list=${playlistId}`
							: `https://www.youtube.com/embed/${videoId}`
					};
				} else if (playlistId) {
					// YouTube playlist only.
					node.tagName = 'iframe';
					node.properties = {
						class: 'external-embed youtube',
						allow: 'fullscreen',
						frameborder: 0,
						width: '600px',
						src: `https://www.youtube.com/embed/videoseries?list=${playlistId}`
					};
				}
			}
		});
	};
}

export type { Element, ElementContent, HtmlRoot };
