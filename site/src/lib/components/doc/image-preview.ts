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
					const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250;
					viewer = new PhotoSwipe({
						dataSource: [
							{
								src: image.currentSrc || image.src,
								width: image.naturalWidth,
								height: image.naturalHeight,
								alt: image.alt,
								element: link,
								msrc: image.currentSrc || image.src
							}
						],
						showHideAnimationType: 'zoom',
						showAnimationDuration: duration,
						hideAnimationDuration: duration,
						zoomAnimationDuration: duration,
						secondaryZoomLevel: 2,
						maxZoomLevel: 4,
						bgOpacity: 0.95
					});
					// Replay early controls after opening, with close taking priority.
					const instance = viewer;
					let ready = false;
					let pending: 'close' | 'zoom' | undefined;
					const close = instance.close.bind(instance);
					const zoom = instance.toggleZoom.bind(instance);
					instance.close = () => {
						if (ready) close();
						else pending = 'close';
					};
					instance.toggleZoom = () => {
						if (ready) zoom();
						else if (pending !== 'close') pending = pending === 'zoom' ? undefined : 'zoom';
					};
					const earlyEscape = (event: KeyboardEvent) => {
						if (!ready && event.key === 'Escape') {
							event.preventDefault();
							event.stopImmediatePropagation();
							pending = 'close';
						}
					};
					document.addEventListener('keydown', earlyEscape, true);
					instance.on('openingAnimationEnd', () => {
						ready = true;
						document.removeEventListener('keydown', earlyEscape, true);
						queueMicrotask(() => {
							if (disposed || viewer !== instance) return;
							if (pending === 'close') close();
							else if (pending === 'zoom') zoom();
							pending = undefined;
						});
					});
					viewer.on('destroy', () => {
						document.removeEventListener('keydown', earlyEscape, true);
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
