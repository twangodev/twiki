import type { Attachment } from 'svelte/attachments';

/**
 * Mermaid diagram island (cca's lazy-import embed pattern, adapted to
 * server-rendered `{@html}` content).
 *
 * The prebuild emits `<pre><code class="mermaid" data-clipboard="...">` for
 * every ```mermaid fence (158 diagrams in the corpus). This attachment:
 *
 *  - keeps the styled raw-source <pre> as the no-JS / pre-hydration fallback,
 *  - lazily `import('mermaid')` only when a diagram scrolls near the viewport
 *    (IntersectionObserver, NOT eager — the library is ~500 kB),
 *  - renders theme-aware (mermaid `dark` vs `default`) and re-renders live
 *    when the documentElement `dark` class flips (mode-watcher toggle),
 *  - on render failure leaves the raw source visible with an error note.
 */

type Mermaid = typeof import('mermaid').default;

let mermaidPromise: Promise<Mermaid> | null = null;
function loadMermaid(): Promise<Mermaid> {
	mermaidPromise ??= import('mermaid').then((m) => m.default);
	return mermaidPromise;
}

function isDark(): boolean {
	return document.documentElement.classList.contains('dark');
}

let idCounter = 0;

interface Block {
	pre: HTMLElement;
	source: string;
	container: HTMLDivElement;
	rendered: boolean;
	/** monotonically increasing render token; stale async renders bail out */
	generation: number;
}

export function mermaidDiagrams(_dep: unknown): Attachment<HTMLElement> {
	return (node) => {
		const codes = Array.from(node.querySelectorAll<HTMLElement>('pre > code.mermaid'));
		if (codes.length === 0) return;

		let destroyed = false;

		const blocks: Block[] = codes.map((code) => {
			const pre = code.parentElement as HTMLElement;
			let source = code.textContent ?? '';
			// the prebuild stores the exact fence body as JSON in data-clipboard
			const clip = code.getAttribute('data-clipboard');
			if (clip) {
				try {
					const parsed: unknown = JSON.parse(clip);
					if (typeof parsed === 'string') source = parsed;
				} catch {
					// fall back to textContent
				}
			}
			const container = document.createElement('div');
			container.className = 'mermaid-diagram';
			container.style.display = 'none';
			pre.insertAdjacentElement('afterend', container);
			return { pre, source, container, rendered: false, generation: 0 };
		});

		async function render(block: Block): Promise<void> {
			const generation = ++block.generation;
			block.pre.dataset.state = 'loading';
			try {
				const mermaid = await loadMermaid();
				if (destroyed || generation !== block.generation) return;
				// initialize is cheap and global; call per render so the theme
				// always matches the current mode at draw time.
				mermaid.initialize({
					startOnLoad: false,
					securityLevel: 'strict',
					theme: isDark() ? 'dark' : 'default'
				});
				const { svg } = await mermaid.render(`mermaid-${++idCounter}`, block.source);
				if (destroyed || generation !== block.generation) return;
				block.container.innerHTML = svg;
				block.container.style.display = '';
				block.pre.style.display = 'none';
				delete block.pre.dataset.state;
				block.rendered = true;
			} catch (e) {
				if (destroyed || generation !== block.generation) return;
				// keep the raw source visible as the fallback, append a note
				block.container.innerHTML = '';
				block.container.style.display = '';
				block.pre.style.display = '';
				block.pre.dataset.state = 'error';
				const msg = document.createElement('p');
				msg.className = 'mermaid-error';
				msg.textContent = `Failed to render diagram: ${e instanceof Error ? e.message : String(e)}`;
				block.container.appendChild(msg);
				block.rendered = false;
			}
		}

		const io = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					io.unobserve(entry.target);
					const block = blocks.find((b) => b.pre === entry.target);
					if (block) void render(block);
				}
			},
			{ rootMargin: '200px 0px' }
		);
		for (const b of blocks) io.observe(b.pre);

		// re-render already-drawn diagrams when light/dark flips
		let wasDark = isDark();
		const mo = new MutationObserver(() => {
			const dark = isDark();
			if (dark === wasDark) return;
			wasDark = dark;
			for (const b of blocks) if (b.rendered) void render(b);
		});
		mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

		return () => {
			destroyed = true;
			io.disconnect();
			mo.disconnect();
			for (const b of blocks) {
				b.container.remove();
				b.pre.style.display = '';
				delete b.pre.dataset.state;
			}
		};
	};
}
