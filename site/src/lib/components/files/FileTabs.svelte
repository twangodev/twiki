<script lang="ts">
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';
	import { X } from '@lucide/svelte';
	import { fileRoute } from '$lib/files';
	import { sameFile, tabLabel, type FileTab } from '$lib/file-tabs';
	import { fileWorkspace } from './file-workspace.svelte';
	import FileIcon from './FileIcon.svelte';
	const { course, path, isFile }: { course: string; path: string; isFile: boolean } = $props();
	const workspace = fileWorkspace();
	const tabs = $derived(
		workspace.ready
			? workspace.tabs
			: isFile
				? [{ course, path, pinned: false, top: 0, left: 0 }]
				: []
	);
	let strip = $state<HTMLElement>();
	$effect(() => {
		course;
		path;
		tabs.length;
		void tick().then(() => {
			const active = strip?.querySelector<HTMLElement>('[aria-current="page"]');
			if (!active || !strip) return;
			const bounds = strip.getBoundingClientRect();
			const item = active.getBoundingClientRect();
			if (item.left < bounds.left) strip.scrollLeft += item.left - bounds.left;
			else if (item.right > bounds.right) strip.scrollLeft += item.right - bounds.right;
		});
	});
	async function close(tab: FileTab) {
		const next = workspace.close(tab);
		if (sameFile(tab, { course, path })) await goto(fileRoute(next?.course ?? course, next?.path));
	}
</script>

<nav
	class="flex min-w-0 flex-1 overflow-x-auto select-none [scrollbar-width:thin]"
	aria-label="Open files"
	bind:this={strip}
>
	{#each tabs as tab (`${tab.course}/${tab.path}`)}
		<div
			class="group flex shrink-0 items-center border-r border-border"
			class:bg-bg={isFile && sameFile(tab, { course, path })}
		>
			<a
				class="flex min-w-0 items-center gap-2 py-2 pl-3 pr-1 font-mono text-xs text-muted no-underline aria-[current=page]:text-text"
				class:italic={!tab.pinned}
				href={fileRoute(tab.course, tab.path)}
				aria-current={isFile && sameFile(tab, { course, path }) ? 'page' : undefined}
				title={`${tab.course}/${tab.path}${!tab.pinned ? ' — double-click to keep open' : ''}`}
				onclick={(event) => workspace.activate(event, tab.course, tab.path)}
			>
				<FileIcon name={tab.path.split('/').at(-1)!} /><span class="max-w-64 truncate"
					>{tabLabel(tab, tabs)}</span
				>
			</a>
			<button
				class="m-0.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface hover:text-text"
				aria-label={`Close ${tabLabel(tab, tabs)}`}
				disabled={!workspace.ready}
				onclick={() => close(tab)}><X size={12} /></button
			>
		</div>
	{/each}
</nav>
