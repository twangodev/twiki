<script lang="ts">
	import { ChevronRight, File, Folder } from '@lucide/svelte';
	import { fileRoute, type FileNode } from '$lib/files';
	import Self from './FileTree.svelte';
	let {
		nodes,
		course,
		current,
		focus,
		expanded = $bindable({})
	}: {
		nodes: FileNode[];
		course: string;
		current: string;
		focus: string;
		expanded?: Record<string, boolean>;
	} = $props();
	const uid = $props.id();
	function open(node: FileNode) {
		return expanded[node.path] ?? (focus === node.path || focus.startsWith(node.path + '/'));
	}
</script>

<ul class="m-0 list-none p-0">
	{#each nodes as node (node.path)}
		<li>
			<div class="flex min-w-0 items-center rounded hover:bg-surface">
				{#if node.children}
					<button
						class="flex size-6 shrink-0 cursor-pointer items-center justify-center text-muted"
						aria-label={`Expand ${node.name}`}
						aria-expanded={open(node)}
						aria-controls={`${uid}-${node.path}`}
						onclick={() => (expanded = { ...expanded, [node.path]: !open(node) })}
					>
						<ChevronRight size={12} class={open(node) ? 'rotate-90' : ''} />
					</button>
				{:else}<span class="w-6 shrink-0"></span>{/if}
				<a
					class="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 text-xs text-muted no-underline hover:text-text aria-[current=page]:text-accent"
					href={fileRoute(course, node.path)}
					title={node.name}
					aria-current={current === node.path ? 'page' : undefined}
				>
					{#if node.children}<Folder size={13} class="shrink-0" />{:else}<File
							size={13}
							class="shrink-0"
						/>{/if}
					<span class="truncate">{node.name}</span>
				</a>
			</div>
			{#if node.children && open(node)}
				<div id={`${uid}-${node.path}`} class="ml-3 border-l border-border pl-1">
					<Self nodes={node.children} {course} {current} {focus} bind:expanded />
				</div>
			{/if}
		</li>
	{/each}
</ul>
