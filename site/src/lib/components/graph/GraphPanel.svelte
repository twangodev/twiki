<script lang="ts">
	/**
	 * Sidebar graph card (Quartz "Graph View" parity).
	 *
	 * Local mode: depth-2 neighborhood of the current page (incl. tag nodes),
	 * rendered by the Quartz pixi.js/d3-force port in a 250px card — same
	 * height and configured depth as this repository's Quartz layout.
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
	let globalOpen = $state(false);

	onMount(() => {
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
		};
	});

	const currentId = $derived(data ? idForRoute(page.url.pathname, data) : undefined);

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

<section class="graph-panel min-w-0 shrink-0" aria-label="Graph view">
	<h3 class="m-0 text-base font-semibold text-text">Graph View</h3>
	<div
		class="relative mt-2 h-[250px] overflow-hidden rounded-[5px] border border-border"
		data-graph-outer
		aria-busy={!data && !failed}
	>
		{#if data && currentId}
			<GraphView {data} {currentId} config={localGraphConfig} />
		{:else if failed}
			<p class="flex h-full items-center justify-center px-4 text-center text-xs text-muted">
				Graph unavailable.
			</p>
		{:else if data}
			<p class="flex h-full items-center justify-center px-4 text-center text-xs text-muted">
				This page is not in the graph.
			</p>
		{:else}
			<div class="flex h-full items-center justify-center" aria-hidden="true">
				<span class="size-5 animate-pulse rounded-full bg-subtle"></span>
			</div>
		{/if}

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
