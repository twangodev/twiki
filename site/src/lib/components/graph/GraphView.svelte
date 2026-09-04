<script lang="ts">
	/**
	 * Shared graph renderer shell (sidebar local graph + global graph dialog).
	 *
	 * The actual rendering is a faithful port of Quartz's pixi.js + d3-force
	 * implementation living in ./render-graph.ts, loaded via dynamic
	 * `import()` from an $effect so pixi/d3/tween never touch the page
	 * bundle. This component only owns the container element, the lazy
	 * mount/destroy lifecycle, theme-flip re-renders and navigation.
	 */
	import type { ClassValue } from 'svelte/elements';
	import { goto } from '$app/navigation';
	import { cn } from '$lib/utils';
	import { hrefForId, type GraphConfig, type GraphData } from './graph-data';

	interface Props {
		data: GraphData;
		/** Node id of the page being viewed (Quartz's `slug`). */
		currentId?: string;
		/** Quartz D3Config equivalent (localGraphConfig / globalGraphConfig). */
		config: GraphConfig;
		/**
		 * Global graph: wheel zoom works bare; the local graph requires
		 * ctrl/meta (Quartz's .global-graph-container class check).
		 */
		global?: boolean;
		class?: ClassValue;
		/** Called when a node navigation starts (lets the dialog close). */
		onnavigate?: () => void;
		/** Called after Pixi has drawn the first node/link frame. */
		onready?: () => void;
		/** Called when the renderer cannot initialize. */
		onerror?: (error: unknown) => void;
	}

	const {
		data,
		currentId,
		config,
		global = false,
		class: className,
		onnavigate,
		onready,
		onerror
	}: Props = $props();

	let container = $state<HTMLDivElement | null>(null);

	// Quartz re-renders the graph on its `themechange` event; the equivalent
	// here is watching the .dark class flip on <html> (mode-watcher toggles it).
	let themeTick = $state(0);
	$effect(() => {
		const observer = new MutationObserver(() => themeTick++);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class']
		});
		return () => observer.disconnect();
	});

	$effect(() => {
		// reactive deps: re-render on data / current page / theme changes
		void themeTick;
		const el = container;
		const args = [data, currentId, config, global] as const;
		if (!el) return;

		let cancelled = false;
		let cleanup: (() => void) | undefined;
		// lazy: pixi.js + d3 + tween.js load only when a graph actually mounts
		void import('./render-graph')
			.then(async ({ renderGraph }) => {
				if (cancelled) return;
				cleanup = await renderGraph(el, args[0], args[1], args[2], args[3], (id) => {
					onnavigate?.();
					void goto(hrefForId(id));
				});
				if (cancelled) cleanup();
				else onready?.();
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					console.error('Knowledge graph renderer failed', error);
					onerror?.(error);
				}
			});
		return () => {
			cancelled = true;
			cleanup?.();
		};
	});
</script>

<div
	bind:this={container}
	class={cn('h-full w-full overflow-hidden', className)}
	role="img"
	aria-label="Knowledge graph"
></div>
