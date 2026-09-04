/** Svelte attachment for cached, anchor-aware previews of internal links. */

import { computePosition, flip, inline, shift } from '@floating-ui/dom';
import type { Attachment } from 'svelte/attachments';
import './popover.css';

const SHOW_DELAY_MS = 300;
const HIDE_DELAY_MS = 150;
const ANCHOR_SCROLL_OFFSET = 12;

type PopoverContent =
	| { kind: 'html'; contentType: string; element: HTMLElement }
	| { kind: 'image'; contentType: string; src: string }
	| { kind: 'pdf'; contentType: string; src: string };

/** Per-pathname cache of fetched + parsed popover content (module-level: survives navigations). */
const contentCache = new Map<string, Promise<PopoverContent | null>>();

/**
 * Rebase relative `href`/`src` attributes of a fetched document against the
 * target page URL, so links/images inside the popover resolve from the
 * *current* page. Port of `normalizeRelativeURLs` (quartz/util/path.ts).
 */
function normalizeRelativeURLs(root: ParentNode, base: URL): void {
	const rebase = (el: Element, attr: string) => {
		const value = el.getAttribute(attr);
		if (value === null) return;
		try {
			const abs = new URL(value, base);
			el.setAttribute(attr, abs.pathname + abs.search + abs.hash);
		} catch {
			/* leave malformed URLs untouched */
		}
	};
	for (const el of root.querySelectorAll('[href=""], [href^="./"], [href^="../"]')) {
		rebase(el, 'href');
	}
	for (const el of root.querySelectorAll('[src=""], [src^="./"], [src^="../"]')) {
		rebase(el, 'src');
	}
}

async function fetchContent(targetUrl: URL): Promise<PopoverContent | null> {
	const response = await fetch(targetUrl.toString()).catch(() => null);
	if (!response || !response.ok) return null;

	const contentType = (response.headers.get('Content-Type') ?? '').split(';')[0].trim();
	if (contentType.startsWith('image/')) {
		return { kind: 'image', contentType, src: targetUrl.toString() };
	}
	if (contentType === 'application/pdf') {
		return { kind: 'pdf', contentType, src: targetUrl.toString() };
	}
	if (!contentType.startsWith('text/html')) return null;

	const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
	normalizeRelativeURLs(doc, targetUrl);
	// Prefix every id so popover content never collides with the host page's
	// heading ids (Quartz `popover-internal-` convention; anchor scroll relies on it).
	for (const el of doc.querySelectorAll('[id]')) {
		el.id = `popover-internal-${el.id}`;
	}

	const article = doc.querySelector<HTMLElement>('article[data-pagefind-body]');
	if (!article) return null;
	article.removeAttribute('data-pagefind-body');
	for (const el of article.querySelectorAll('script, style, link, [data-island]')) el.remove();

	return { kind: 'html', contentType, element: document.importNode(article, true) };
}

/**
 * Attachment factory. Apply to the rendered-content container; re-created per
 * route via the `dep` key (same pattern as `copyButtons`/`calloutFold`).
 */
export function linkPopovers(_dep: unknown): Attachment<HTMLElement> {
	return (node) => {
		// Hover intent is meaningless on touch; bail entirely (CSS double-guards).
		if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

		let popoverEl: HTMLDivElement | null = null;
		let popoverInner: HTMLDivElement | null = null;
		let showTimer: ReturnType<typeof setTimeout> | undefined;
		let hideTimer: ReturnType<typeof setTimeout> | undefined;
		/** Generation counter: bumping it invalidates in-flight show() work. */
		let generation = 0;

		function ensurePopover(): { el: HTMLDivElement; inner: HTMLDivElement } {
			if (popoverEl && popoverInner) return { el: popoverEl, inner: popoverInner };
			popoverEl = document.createElement('div');
			popoverEl.className = 'popover';
			popoverEl.setAttribute('role', 'tooltip');
			popoverInner = document.createElement('div');
			popoverInner.className = 'popover-inner';
			popoverEl.appendChild(popoverInner);
			// Keep the card open while the pointer is over it (scrollable preview).
			popoverEl.addEventListener('mouseenter', cancelHide);
			popoverEl.addEventListener('mouseleave', scheduleHide);
			document.body.appendChild(popoverEl);
			return { el: popoverEl, inner: popoverInner };
		}

		function hide(): void {
			generation++;
			clearTimeout(showTimer);
			clearTimeout(hideTimer);
			popoverEl?.classList.remove('active-popover');
		}

		function scheduleHide(): void {
			clearTimeout(showTimer);
			clearTimeout(hideTimer);
			hideTimer = setTimeout(hide, HIDE_DELAY_MS);
		}

		function cancelHide(): void {
			clearTimeout(hideTimer);
		}

		async function show(link: HTMLAnchorElement, coords: { x: number; y: number }) {
			const myGeneration = ++generation;

			const targetUrl = new URL(link.href);
			if (targetUrl.origin !== window.location.origin) return;
			const hash = decodeURIComponent(targetUrl.hash);
			targetUrl.hash = '';
			targetUrl.search = '';

			const cacheKey = targetUrl.pathname;
			let pending = contentCache.get(cacheKey);
			if (!pending) {
				pending = fetchContent(targetUrl);
				contentCache.set(cacheKey, pending);
				// Don't poison the cache on transient network failure.
				pending.then((content) => {
					if (content === null) contentCache.delete(cacheKey);
				});
			}

			const content = await pending;
			if (content === null || myGeneration !== generation) return;

			const { el, inner } = ensurePopover();
			inner.replaceChildren();
			inner.scrollTop = 0;
			inner.dataset.contentType = content.contentType;

			switch (content.kind) {
				case 'image': {
					const img = document.createElement('img');
					img.src = content.src;
					img.alt = new URL(content.src).pathname;
					inner.className = 'popover-inner';
					inner.appendChild(img);
					break;
				}
				case 'pdf': {
					const iframe = document.createElement('iframe');
					iframe.src = content.src;
					iframe.title = new URL(content.src).pathname;
					inner.className = 'popover-inner';
					inner.appendChild(iframe);
					break;
				}
				case 'html': {
					inner.className = 'popover-inner prose prose-sm dark:prose-invert';
					// Clone so the cached tree is never mutated by the live DOM.
					inner.appendChild(content.element.cloneNode(true));
					break;
				}
			}

			const { x, y } = await computePosition(link, el, {
				strategy: 'fixed',
				middleware: [inline({ x: coords.x, y: coords.y }), shift({ padding: 12 }), flip()]
			});
			if (myGeneration !== generation) return;
			el.style.transform = `translate(${x.toFixed()}px, ${y.toFixed()}px)`;
			el.classList.add('active-popover');

			if (hash !== '' && content.kind === 'html') {
				const heading = inner.querySelector<HTMLElement>(
					`#popover-internal-${CSS.escape(hash.slice(1))}`
				);
				if (heading) {
					inner.scroll({ top: heading.offsetTop - ANCHOR_SCROLL_OFFSET, behavior: 'instant' });
				}
			}
		}

		const onKeydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && popoverEl?.classList.contains('active-popover')) {
				hide();
			}
		};
		document.addEventListener('keydown', onKeydown);

		const links = Array.from(node.querySelectorAll<HTMLAnchorElement>('a.internal')).filter(
			(link) => link.dataset.noPopover !== 'true'
		);
		const cleanups = links.map((link) => {
			const onEnter = (event: MouseEvent) => {
				cancelHide();
				clearTimeout(showTimer);
				showTimer = setTimeout(
					() => void show(link, { x: event.clientX, y: event.clientY }),
					SHOW_DELAY_MS
				);
			};
			const onLeave = () => {
				clearTimeout(showTimer);
				scheduleHide();
			};
			link.addEventListener('mouseenter', onEnter);
			link.addEventListener('mouseleave', onLeave);
			return () => {
				link.removeEventListener('mouseenter', onEnter);
				link.removeEventListener('mouseleave', onLeave);
			};
		});

		return () => {
			generation++;
			clearTimeout(showTimer);
			clearTimeout(hideTimer);
			document.removeEventListener('keydown', onKeydown);
			cleanups.forEach((fn) => fn());
			popoverEl?.remove();
			popoverEl = null;
			popoverInner = null;
		};
	};
}
