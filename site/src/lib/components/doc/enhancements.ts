import type { Attachment } from 'svelte/attachments';
import { mermaidDiagrams } from '$lib/components/embeds/mermaid';

/**
 * Client-side enhancements applied to rendered markdown content. Each is an
 * attachment that runs after the article element is in the DOM and re-runs when
 * its keyed dependency (the current route key) changes.
 *
 * Ported from cca minus filePreviews/kotlinPlayground (dropped for wisconsin).
 * `enhanceArticle` below is the single entry point composing all of them
 * (copy buttons, callout folding, lazy mermaid hydration). External-link
 * icons need no JS — they are baked in at build time (build-content.ts
 * CrawlLinks port) and styled by layout.css `.external-icon`.
 */

export { mermaidDiagrams };

/** Single entry point: applies every content enhancement to the article. */
export function enhanceArticle(dep: unknown): Attachment<HTMLElement> {
	return (node) => {
		const cleanups = [
			copyButtons(dep)(node),
			headingAnchors(dep)(node),
			calloutFold(dep)(node),
			mermaidDiagrams(dep)(node)
		];
		return () => {
			for (const cleanup of cleanups) cleanup?.();
		};
	};
}

const LINK_ICON =
	'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

/** Restore Quartz's visible deep-link affordance without changing heading ids. */
export function headingAnchors(_dep: unknown): Attachment<HTMLElement> {
	return (node) => {
		const anchors = Array.from(
			node.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')
		).map((heading) => {
			const anchor = document.createElement('a');
			anchor.className = 'heading-anchor';
			anchor.href = `#${encodeURIComponent(heading.id)}`;
			anchor.setAttribute('aria-label', `Link to ${heading.textContent?.trim() || 'heading'}`);
			anchor.title = 'Link to this heading';
			anchor.innerHTML = LINK_ICON;
			heading.appendChild(anchor);
			return anchor;
		});
		return () => anchors.forEach((anchor) => anchor.remove());
	};
}

const COPY_ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const CHECK_ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

/**
 * Adds a copy-to-clipboard button to every Shiki code block. Keyed on `dep` so
 * it re-runs when navigating between docs.
 */
export function copyButtons(_dep: unknown): Attachment<HTMLElement> {
	return (node) => {
		const blocks = Array.from(node.querySelectorAll('pre.shiki'));
		const cleanups = blocks.map((pre) => {
			const wrapper = document.createElement('div');
			wrapper.className = 'code-block';
			pre.replaceWith(wrapper);
			wrapper.appendChild(pre);

			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'copy-button';
			button.setAttribute('aria-label', 'Copy code');
			button.innerHTML = COPY_ICON;
			wrapper.appendChild(button);

			let timer: ReturnType<typeof setTimeout>;
			const onClick = async () => {
				try {
					await navigator.clipboard.writeText(pre.querySelector('code')?.textContent ?? '');
					button.classList.add('copied');
					button.innerHTML = CHECK_ICON;
					clearTimeout(timer);
					timer = setTimeout(() => {
						button.classList.remove('copied');
						button.innerHTML = COPY_ICON;
					}, 1600);
				} catch {
					button.setAttribute('aria-label', 'Copy failed');
				}
			};
			button.addEventListener('click', onClick);

			return () => {
				clearTimeout(timer);
				button.removeEventListener('click', onClick);
			};
		});

		return () => cleanups.forEach((fn) => fn());
	};
}

/**
 * Collapsible Obsidian callouts ([!type]- / [!type]+). The prebuild emits the
 * Quartz fork's structure (blockquote.callout.is-collapsible[.is-collapsed] >
 * .callout-title + .callout-content); collapse/expand is pure CSS
 * (grid-template-rows keyed on .is-collapsed) so this only toggles the class.
 * Ported from quartz/components/scripts/callout.inline.ts.
 */
export function calloutFold(_dep: unknown): Attachment<HTMLElement> {
	return (node) => {
		const titles = Array.from(
			node.querySelectorAll<HTMLElement>('.callout.is-collapsible > .callout-title')
		);
		const cleanups = titles.map((title) => {
			const callout = title.parentElement!;
			const onClick = () => {
				const collapsed = callout.classList.toggle('is-collapsed');
				title.setAttribute('aria-expanded', String(!collapsed));
			};
			title.setAttribute('role', 'button');
			title.setAttribute('tabindex', '0');
			title.setAttribute('aria-expanded', String(!callout.classList.contains('is-collapsed')));
			const onKey = (e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onClick();
				}
			};
			title.addEventListener('click', onClick);
			title.addEventListener('keydown', onKey);
			return () => {
				title.removeEventListener('click', onClick);
				title.removeEventListener('keydown', onKey);
			};
		});

		return () => cleanups.forEach((fn) => fn());
	};
}
