<script lang="ts">
	/**
	 * Sidebar graph card (Quartz "Graph View" parity).
	 *
	 * Local mode: depth-2 neighborhood of the current page, settled force
	 * layout in a small card. Global mode: button in the card header opens the
	 * full-corpus dialog. Graph data is fetched once from the prerendered
	 * `/graph.json` endpoint, after mount — never part of page payloads.
	 *
	 * This whole module (incl. layerchart + d3-force) is loaded via dynamic
	 * `import()` from DocShell, so none of it lands in the initial bundle.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { Maximize2 } from '@lucide/svelte';
	import {
		buildIndex,
		courseColors,
		idForRoute,
		loadGraph,
		neighborhood,
		type GraphData,
		type GraphIndex,
		type GraphLink,
		type GraphNode
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

	const index = $derived<GraphIndex | null>(data ? buildIndex(data) : null);
	const colors = $derived(index ? courseColors(index) : new Map<string, string>());
	const currentId = $derived(index ? idForRoute(page.url.pathname, index) : undefined);

	/** Depth-2 neighborhood subgraph of the current page. */
	const local = $derived.by<{ nodes: GraphNode[]; links: GraphLink[] } | null>(() => {
		if (!data || !index || !currentId) return null;
		const ids = neighborhood(index, currentId, 2);
		return {
			nodes: data.nodes.filter((n) => ids.has(n.id)),
			links: data.links.filter((l) => ids.has(l.source) && ids.has(l.target))
		};
	});
</script>

{#if data && index}
	<section class="rounded-lg border border-border bg-surface/40" aria-label="Graph view">
		<header class="flex items-center justify-between gap-2 px-3 pt-2">
			<h2 class="m-0 text-[0.7rem] font-bold tracking-[0.08em] text-muted uppercase">Graph</h2>
			<button
				type="button"
				class="inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
				aria-label="Open global graph"
				title="Global graph"
				onclick={() => (globalOpen = true)}
			>
				<Maximize2 class="size-3.5" aria-hidden="true" />
			</button>
		</header>
		<div class="h-44 px-1 pb-1">
			{#if local && local.nodes.length > 1}
				{#key currentId}
					<GraphView
						nodes={local.nodes}
						links={local.links}
						degree={index.degree}
						{colors}
						{currentId}
						labelLimit={local.nodes.length <= 24 ? local.nodes.length : 8}
						charge={-100}
					/>
				{/key}
			{:else}
				<p class="flex h-full items-center justify-center text-xs text-muted">
					{local ? 'No connections yet.' : 'This page is not in the graph.'}
				</p>
			{/if}
		</div>
	</section>

	<GraphDialog bind:open={globalOpen} {data} {index} {currentId} />
{/if}
