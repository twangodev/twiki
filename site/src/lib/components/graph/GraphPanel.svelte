<script lang="ts">
	/**
	 * Sidebar graph card (Quartz "Graph View" parity).
	 *
	 * Local mode: depth-2 neighborhood of the current page (incl. tag nodes),
	 * rendered by the Quartz pixi.js/d3-force port in a 250px card — same
	 * height as Quartz's .graph-outer. Global mode: button in the card header
	 * (or ctrl/cmd+g, as in Quartz) opens the full-corpus dialog. Graph data
	 * is fetched once from the prerendered `/graph.json` endpoint, after
	 * mount — never part of page payloads.
	 *
	 * This whole module is loaded via dynamic `import()` from DocShell, and
	 * the heavy renderer (pixi.js/d3/tween) is a further dynamic import inside
	 * GraphView, so none of it lands in the initial bundle.
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
	let globalOpen = $state(false);

	onMount(() => {
		loadGraph().then(
			(g) => (data = g),
			() => {} // graph is progressive enhancement; fail silently
		);
	});

	const currentId = $derived(data ? idForRoute(page.url.pathname, data) : undefined);

	// Quartz records every navigated-to page in localStorage ("graph-visited")
	// and tints visited nodes; mirror that on every route change.
	$effect(() => {
		if (currentId) addToVisited(currentId);
	});

	// Quartz binds ctrl/cmd+g to toggle the global graph.
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'g' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
			e.preventDefault();
			globalOpen = !globalOpen;
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if data}
	<section class="rounded-lg border border-border bg-surface/40" aria-label="Graph view">
		<header class="flex items-center justify-between gap-2 px-3 pt-2">
			<h2 class="m-0 text-[0.7rem] font-bold tracking-[0.08em] text-muted uppercase">Graph</h2>
			<button
				type="button"
				class="inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
				aria-label="Open global graph"
				title="Global graph (⌘G)"
				onclick={() => (globalOpen = true)}
			>
				<Maximize2 class="size-3.5" aria-hidden="true" />
			</button>
		</header>
		<!-- 250px matches Quartz's .graph-outer height -->
		<div class="h-[250px] px-1 pb-1">
			{#if currentId}
				<GraphView {data} {currentId} config={localGraphConfig} />
			{:else}
				<p class="flex h-full items-center justify-center text-xs text-muted">
					This page is not in the graph.
				</p>
			{/if}
		</div>
	</section>

	<GraphDialog bind:open={globalOpen} {data} {currentId} />
{/if}
