<script lang="ts">
	/**
	 * Sidebar graph card (Quartz "Graph View" parity).
	 *
	 * Local mode: depth-2 neighborhood of the current page (incl. tag nodes),
	 * rendered by the Quartz pixi.js/d3-force port in a 250px card — same
	 * height and configured depth as this repository's Quartz layout. The page
	 * being read remains anchored at the center of the preview.
	 * Global mode: button over the graph canvas
	 * (or ctrl/cmd+g, as in Quartz) opens the full-corpus dialog. Graph data
	 * is fetched once from the prerendered `/graph.json` endpoint, while the
	 * renderer chunk loads in parallel — never part of page payloads.
	 *
	 * The shell is server-rendered to reserve its final dimensions immediately.
	 * The heavy renderer (pixi.js/d3/tween) remains a dynamic import, so it does
	 * not land in the initial bundle.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { Maximize2 } from '@lucide/svelte';
	import {
		addToVisited,
		idForRoute,
		loadGraph,
		localGraphConfig,
		type GraphData
	} from './graph-data';
	import GraphDialog from './GraphDialog.svelte';
	import GraphView from './GraphView.svelte';

	let data = $state<GraphData | null>(null);
	let failed = $state(false);
	let renderReady = $state(false);
	let globalOpen = $state(false);
	let wide = $state(false);

	onMount(() => {
		const media = window.matchMedia('(width >= 1440px)');
		const updateWidth = () => (wide = media.matches);
		updateWidth();
		media.addEventListener('change', updateWidth);
		let cancelled = false;
		void Promise.all([loadGraph(), import('./render-graph')]).then(
			([graph]) => {
				if (!cancelled) data = graph;
			},
			() => {
				if (!cancelled) failed = true;
			}
		);
		return () => {
			cancelled = true;
			media.removeEventListener('change', updateWidth);
		};
	});

	const currentId = $derived(data ? idForRoute(page.url.pathname, data) : undefined);
	function handleRenderError() {
		failed = true;
	}

	// Quartz records every navigated-to page in localStorage ("graph-visited")
	// and tints visited nodes; mirror that on every route change.
	$effect(() => {
		if (currentId) addToVisited(currentId);
	});

	// Quartz binds ctrl/cmd+g to toggle the global graph.
	function onKeydown(e: KeyboardEvent) {
		if (data && e.key === 'g' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
			e.preventDefault();
			globalOpen = !globalOpen;
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<button
	type="button"
	class="doc-compact-graph cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface disabled:opacity-50"
	disabled={!data}
	onclick={() => (globalOpen = true)}
>
	Open global graph
</button>
<section class="graph-panel min-w-0 shrink-0" aria-label="Graph view">
	<div
		class="relative h-[250px] overflow-hidden"
		data-graph-outer
		aria-busy={!failed && (!data || (Boolean(currentId) && !renderReady))}
	>
		{#if failed}
			<p class="flex h-full items-center justify-center px-4 text-center text-xs text-muted">
				Graph unavailable.
			</p>
		{:else if data && currentId && wide}
			<GraphView
				{data}
				{currentId}
				config={localGraphConfig}
				onready={() => (renderReady = true)}
				onerror={handleRenderError}
			/>
			{#if !renderReady}
				<div
					class="pointer-events-none absolute inset-0 flex items-center justify-center"
					aria-hidden="true"
				>
					<span class="size-5 animate-pulse rounded-full bg-subtle"></span>
				</div>
			{/if}
		{:else if data}
			<p class="flex h-full items-center justify-center px-4 text-center text-xs text-muted">
				This page is not in the graph.
			</p>
		{:else}
			<div class="flex h-full items-center justify-center" aria-hidden="true">
				<span class="size-5 animate-pulse rounded-full bg-subtle"></span>
			</div>
		{/if}

		<h3
			class="pointer-events-none absolute top-1 left-1 m-0 rounded bg-bg/80 px-1.5 py-1 text-xs font-medium text-muted"
		>
			Graph View
		</h3>
		<button
			type="button"
			class="absolute top-1 right-1 inline-flex size-6 cursor-pointer items-center justify-center rounded text-muted transition-colors hover:bg-surface hover:text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-wait"
			aria-label="Open global graph"
			title="Global graph (⌘G)"
			disabled={!data}
			onclick={() => (globalOpen = true)}
		>
			<Maximize2 class="size-3.5" aria-hidden="true" />
		</button>
	</div>
</section>

{#if data}
	<GraphDialog bind:open={globalOpen} {data} {currentId} />
{/if}
