<script lang="ts">
	/**
	 * Global graph view: the full corpus (~660 nodes) in a modal dialog,
	 * zoomable/pannable. Mounted only while open — the 200-tick static
	 * simulation runs on open (~100 ms at this corpus size) and then never
	 * ticks again.
	 */
	import { X } from '@lucide/svelte';
	import { DialogClose, DialogContent, DialogOverlay, DialogRoot, DialogTitle } from '$lib/components/ui';
	import GraphView from './GraphView.svelte';
	import type { GraphData, GraphIndex } from './graph-data';
	import { courseColors } from './graph-data';

	interface Props {
		open?: boolean;
		data: GraphData;
		index: GraphIndex;
		currentId?: string;
	}

	let { open = $bindable(false), data, index, currentId }: Props = $props();

	const colors = $derived(courseColors(index));
</script>

<DialogRoot bind:open>
	<DialogOverlay />
	<DialogContent class="flex h-[85vh] max-w-5xl flex-col gap-3 p-4">
		<div class="flex items-center justify-between gap-3">
			<DialogTitle>Graph view</DialogTitle>
			<DialogClose
				class="inline-flex size-7 items-center justify-center rounded-md hover:bg-surface"
				><X class="size-4" aria-hidden="true" /><span class="sr-only">Close</span></DialogClose
			>
		</div>
		<div class="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-surface/40">
			{#if open}
				<GraphView
					nodes={data.nodes}
					links={data.links}
					degree={index.degree}
					{colors}
					{currentId}
					zoomable
					labelLimit={36}
					linkDistance={36}
					charge={-55}
					onnavigate={() => (open = false)}
				/>
			{/if}
		</div>
		<p class="m-0 text-xs text-muted">
			Scroll to zoom, drag to pan. Node size = connections; colors = course.
		</p>
	</DialogContent>
</DialogRoot>
