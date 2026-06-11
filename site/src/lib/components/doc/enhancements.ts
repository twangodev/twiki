import type { Attachment } from 'svelte/attachments';

/**
 * Client-side enhancements applied to rendered markdown content. Each is an
 * attachment that runs after the article element is in the DOM and re-runs when
 * its keyed dependency (the current route key) changes.
 *
 * Ported from cca minus filePreviews/kotlinPlayground (dropped for wisconsin).
 */

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
