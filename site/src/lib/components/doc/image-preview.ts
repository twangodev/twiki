import type { Attachment } from 'svelte/attachments';
import type PhotoSwipe from 'photoswipe';
import 'photoswipe/style.css';

/** Add previews to note images without taking over existing links or controls. */
export function imagePreviews(_dep: unknown): Attachment<HTMLElement> {
	return (node) => {
		let disposed = false;
		let opening = false;
		let viewer: PhotoSwipe | undefined;
		const cleanups: (() => void)[] = [];

		for (const image of node.querySelectorAll<HTMLImageElement>('img')) {
			if (image.closest('a, button, [role="button"]')) continue;
			const content = image.closest('picture') ?? image;
			const link = document.createElement('a');
			link.href = image.currentSrc || image.src;
			link.className = 'image-preview';
			link.style.cursor = 'zoom-in';
			link.setAttribute('aria-label', `Enlarge image${image.alt ? `: ${image.alt}` : ''}`);
			link.setAttribute('aria-haspopup', 'dialog');
			link.setAttribute('data-sveltekit-reload', '');
			content.replaceWith(link);
			link.append(content);

			const open = async (event: MouseEvent) => {
				if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
					return;
				// Broken or still-loading images retain a normal link to the original.
				if (!image.naturalWidth || !image.naturalHeight) return;
				event.preventDefault();
				if (opening || viewer) return;
				opening = true;
				link.focus({ preventScroll: true });
				try {
					const { default: PhotoSwipe } = await import('photoswipe');
					if (disposed) return;
					viewer = new PhotoSwipe({
						dataSource: [
							{
								src: image.currentSrc || image.src,
								width: image.naturalWidth,
								height: image.naturalHeight,
								alt: image.alt
							}
						],
						showHideAnimationType: 'none',
						zoomAnimationDuration: window.matchMedia('(prefers-reduced-motion: reduce)').matches
							? 0
							: 200,
						secondaryZoomLevel: 2,
						maxZoomLevel: 4,
						bgOpacity: 0.95
					});
					viewer.on('destroy', () => {
						viewer = undefined;
					});
					viewer.init();
				} catch {
					if (!disposed) window.location.assign(link.href);
				} finally {
					opening = false;
				}
			};
			link.addEventListener('click', open);
			cleanups.push(() => {
				link.removeEventListener('click', open);
				link.replaceWith(content);
			});
		}

		return () => {
			disposed = true;
			viewer?.destroy();
			cleanups.forEach((cleanup) => cleanup());
		};
	};
}
