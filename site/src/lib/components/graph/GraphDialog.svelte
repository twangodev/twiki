<script lang="ts">
	/**
	 * Global graph view: the full corpus (~660 pages + tag nodes) in a modal
	 * dialog. Mounted only while open — the pixi app and live d3-force
	 * simulation are created on open and fully destroyed on close (no WebGL
	 * context leaks across repeated opens). Quartz's global graph settings:
	 * radial force, focus-on-hover, free wheel zoom.
	 */
	import { X } from '@lucide/svelte';
	import {
		DialogClose,
		DialogContent,
		DialogOverlay,
		DialogRoot,
		DialogTitle
	} from '$lib/components/ui';
	import GraphView from './GraphView.svelte';
	import { globalGraphConfig, type GraphData } from './graph-data';

	interface Props {
		open?: boolean;
		data: GraphData;
		currentId?: string;
	}

	let { open = $bindable(false), data, currentId }: Props = $props();
</script>

<DialogRoot bind:open>
	<DialogOverlay />
	<DialogContent
		class="flex h-[80vh] w-[80vw] max-w-none flex-col gap-3 p-4 max-[768px]:h-[90vh] max-[768px]:w-[94vw]"
	>
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
					{data}
					{currentId}
					config={globalGraphConfig}
					global
					onnavigate={() => (open = false)}
				/>
			{/if}
		</div>
		<p class="m-0 text-xs text-muted">
			Drag nodes to rearrange, scroll to zoom, click to open a page. Node size = connections.
		</p>
	</DialogContent>
</DialogRoot>
