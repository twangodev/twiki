import type { Attachment } from 'svelte/attachments';

/**
 * Lazy Mermaid renderer with the interaction contract from Quartz: source
 * copy, fullscreen expansion, pointer pan, wheel/button zoom and reset.
 * Markdown in this site is a trusted, private corpus, so `loose` security is
 * retained for Quartz-compatible HTML labels.
 */

type Mermaid = typeof import('mermaid').default;

let mermaidPromise: Promise<Mermaid> | null = null;
function loadMermaid(): Promise<Mermaid> {
	mermaidPromise ??= import('mermaid').then((module) => module.default);
	return mermaidPromise;
}

function isDark(): boolean {
	return document.documentElement.classList.contains('dark');
}

function mermaidTheme() {
	const style = getComputedStyle(document.documentElement);
	const value = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
	return {
		fontFamily: value('--font-mono', 'monospace'),
		primaryColor: value('--color-bg', '#ffffff'),
		primaryTextColor: value('--color-text', '#1a1916'),
		primaryBorderColor: value('--color-accent', '#c2413b'),
		lineColor: value('--color-muted', '#78716c'),
		secondaryColor: value('--color-surface', '#f5f3ef'),
		tertiaryColor: value('--color-subtle', '#e7e2d9'),
		clusterBkg: value('--color-bg', '#ffffff'),
		edgeLabelBackground: value('--color-surface', '#f5f3ef')
	};
}

const COPY_ICON =
	'<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const EXPAND_ICON =
	'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';

function makeButton(label: string, content: string, className = ''): HTMLButtonElement {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = `mermaid-control-button ${className}`.trim();
	button.setAttribute('aria-label', label);
	button.title = label;
	button.innerHTML = content;
	return button;
}

let idCounter = 0;

interface Block {
	pre: HTMLElement;
	source: string;
	container: HTMLDivElement;
	content: HTMLDivElement;
	copyButton: HTMLButtonElement;
	expandButton: HTMLButtonElement;
	rendered: boolean;
	generation: number;
	copyTimer?: ReturnType<typeof setTimeout>;
}

export function mermaidDiagrams(_dep: unknown): Attachment<HTMLElement> {
	return (node) => {
		const codes = Array.from(node.querySelectorAll<HTMLElement>('pre > code.mermaid'));
		if (codes.length === 0) return;

		let destroyed = false;
		let closeExpanded: (() => void) | undefined;

		const blocks: Block[] = codes.map((code) => {
			const pre = code.parentElement as HTMLElement;
			let source = code.textContent ?? '';
			const clipboardSource = code.getAttribute('data-clipboard');
			if (clipboardSource) {
				try {
					const parsed: unknown = JSON.parse(clipboardSource);
					if (typeof parsed === 'string') source = parsed;
				} catch {
					// Keep textContent as the no-JS/error fallback.
				}
			}

			const container = document.createElement('div');
			container.className = 'mermaid-diagram';
			container.style.display = 'none';
			const content = document.createElement('div');
			content.className = 'mermaid-inline-content';
			const toolbar = document.createElement('div');
			toolbar.className = 'mermaid-toolbar';
			const expandButton = makeButton('Expand diagram', EXPAND_ICON, 'mermaid-expand-button');
			const copyButton = makeButton('Copy diagram source', COPY_ICON, 'mermaid-copy-button');
			toolbar.append(expandButton, copyButton);
			container.append(content, toolbar);
			pre.insertAdjacentElement('afterend', container);

			return {
				pre,
				source,
				container,
				content,
				copyButton,
				expandButton,
				rendered: false,
				generation: 0
			};
		});

		function closeModal(): void {
			closeExpanded?.();
			closeExpanded = undefined;
		}

		function openModal(block: Block): void {
			const sourceSvg = block.content.querySelector('svg');
			if (!sourceSvg) return;
			closeModal();

			const modal = document.createElement('div');
			modal.className = 'mermaid-modal';
			modal.setAttribute('role', 'dialog');
			modal.setAttribute('aria-modal', 'true');
			modal.setAttribute('aria-label', 'Expanded diagram');

			const panel = document.createElement('div');
			panel.className = 'mermaid-modal-panel';
			const controls = document.createElement('div');
			controls.className = 'mermaid-modal-controls';
			const zoomOut = makeButton('Zoom out', '−');
			const reset = makeButton('Reset zoom', 'Reset');
			reset.classList.add('mermaid-reset-button');
			const zoomIn = makeButton('Zoom in', '+');
			const close = makeButton('Close expanded diagram', '×');
			controls.append(zoomOut, reset, zoomIn, close);

			const viewport = document.createElement('div');
			viewport.className = 'mermaid-modal-viewport';
			const modalContent = document.createElement('div');
			modalContent.className = 'mermaid-modal-content';
			modalContent.append(sourceSvg.cloneNode(true));
			viewport.appendChild(modalContent);
			panel.append(controls, viewport);
			modal.appendChild(panel);
			document.body.appendChild(modal);
			document.body.classList.add('mermaid-modal-open');

			let scale = 1;
			let panX = 0;
			let panY = 0;
			let dragging = false;
			let pointerId = -1;
			let startX = 0;
			let startY = 0;
			const applyTransform = () => {
				modalContent.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
			};
			const changeZoom = (delta: number) => {
				scale = Math.min(3, Math.max(0.5, scale + delta));
				applyTransform();
			};
			const resetTransform = () => {
				scale = 1;
				panX = 0;
				panY = 0;
				applyTransform();
			};

			const onPointerDown = (event: PointerEvent) => {
				if (event.button !== 0) return;
				dragging = true;
				pointerId = event.pointerId;
				startX = event.clientX - panX;
				startY = event.clientY - panY;
				viewport.setPointerCapture(pointerId);
				viewport.classList.add('is-dragging');
			};
			const onPointerMove = (event: PointerEvent) => {
				if (!dragging || event.pointerId !== pointerId) return;
				panX = event.clientX - startX;
				panY = event.clientY - startY;
				applyTransform();
			};
			const onPointerUp = (event: PointerEvent) => {
				if (event.pointerId !== pointerId) return;
				dragging = false;
				viewport.classList.remove('is-dragging');
				if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
				pointerId = -1;
			};
			const onWheel = (event: WheelEvent) => {
				event.preventDefault();
				changeZoom(event.deltaY < 0 ? 0.1 : -0.1);
			};
			const onBackdrop = (event: MouseEvent) => {
				if (event.target === modal) closeModal();
			};
			const onKeydown = (event: KeyboardEvent) => {
				if (event.key === 'Escape') closeModal();
			};
			const onZoomOut = () => changeZoom(-0.1);
			const onZoomIn = () => changeZoom(0.1);

			viewport.addEventListener('pointerdown', onPointerDown);
			viewport.addEventListener('pointermove', onPointerMove);
			viewport.addEventListener('pointerup', onPointerUp);
			viewport.addEventListener('pointercancel', onPointerUp);
			viewport.addEventListener('wheel', onWheel, { passive: false });
			modal.addEventListener('click', onBackdrop);
			document.addEventListener('keydown', onKeydown);
			zoomOut.addEventListener('click', onZoomOut);
			zoomIn.addEventListener('click', onZoomIn);
			reset.addEventListener('click', resetTransform);

			const finish = () => {
				viewport.removeEventListener('pointerdown', onPointerDown);
				viewport.removeEventListener('pointermove', onPointerMove);
				viewport.removeEventListener('pointerup', onPointerUp);
				viewport.removeEventListener('pointercancel', onPointerUp);
				viewport.removeEventListener('wheel', onWheel);
				modal.removeEventListener('click', onBackdrop);
				document.removeEventListener('keydown', onKeydown);
				zoomOut.removeEventListener('click', onZoomOut);
				zoomIn.removeEventListener('click', onZoomIn);
				reset.removeEventListener('click', resetTransform);
				close.removeEventListener('click', closeModal);
				modal.remove();
				document.body.classList.remove('mermaid-modal-open');
				block.expandButton.focus();
			};
			closeExpanded = finish;
			close.addEventListener('click', closeModal);
			close.focus();
		}

		const buttonCleanups = blocks.flatMap((block) => {
			const copy = async () => {
				try {
					await navigator.clipboard.writeText(block.source);
					block.copyButton.classList.add('copied');
					block.copyButton.setAttribute('aria-label', 'Diagram source copied');
					block.copyButton.innerHTML = CHECK_ICON;
					clearTimeout(block.copyTimer);
					block.copyTimer = setTimeout(() => {
						block.copyButton.classList.remove('copied');
						block.copyButton.setAttribute('aria-label', 'Copy diagram source');
						block.copyButton.innerHTML = COPY_ICON;
					}, 1600);
				} catch {
					block.copyButton.setAttribute('aria-label', 'Copy failed');
				}
			};
			const expand = () => openModal(block);
			block.copyButton.addEventListener('click', copy);
			block.expandButton.addEventListener('click', expand);
			return [
				() => block.copyButton.removeEventListener('click', copy),
				() => block.expandButton.removeEventListener('click', expand)
			];
		});

		async function render(block: Block): Promise<void> {
			const generation = ++block.generation;
			block.pre.dataset.state = 'loading';
			try {
				const mermaid = await loadMermaid();
				if (destroyed || generation !== block.generation) return;
				mermaid.initialize({
					startOnLoad: false,
					securityLevel: 'loose',
					theme: isDark() ? 'dark' : 'base',
					themeVariables: mermaidTheme()
				});
				const { svg } = await mermaid.render(`mermaid-${++idCounter}`, block.source);
				if (destroyed || generation !== block.generation) return;
				closeModal();
				block.content.innerHTML = svg;
				block.container.style.display = '';
				block.pre.style.display = 'none';
				block.expandButton.disabled = false;
				delete block.pre.dataset.state;
				block.rendered = true;
			} catch (error) {
				if (destroyed || generation !== block.generation) return;
				block.content.replaceChildren();
				block.container.style.display = '';
				block.pre.style.display = '';
				block.pre.dataset.state = 'error';
				block.expandButton.disabled = true;
				const message = document.createElement('p');
				message.className = 'mermaid-error';
				message.textContent = `Failed to render diagram: ${error instanceof Error ? error.message : String(error)}`;
				block.content.appendChild(message);
				block.rendered = false;
			}
		}

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					observer.unobserve(entry.target);
					const block = blocks.find((candidate) => candidate.pre === entry.target);
					if (block) void render(block);
				}
			},
			{ rootMargin: '200px 0px' }
		);
		for (const block of blocks) observer.observe(block.pre);

		let wasDark = isDark();
		const themeObserver = new MutationObserver(() => {
			const dark = isDark();
			if (dark === wasDark) return;
			wasDark = dark;
			for (const block of blocks) if (block.rendered) void render(block);
		});
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class']
		});

		return () => {
			destroyed = true;
			closeModal();
			observer.disconnect();
			themeObserver.disconnect();
			buttonCleanups.forEach((cleanup) => cleanup());
			for (const block of blocks) {
				clearTimeout(block.copyTimer);
				block.container.remove();
				block.pre.style.display = '';
				delete block.pre.dataset.state;
			}
		};
	};
}
