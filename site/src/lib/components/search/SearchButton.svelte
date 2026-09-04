<script lang="ts">
	import { onMount } from 'svelte';
	import { Command, Search } from '@lucide/svelte';
	import type { ClassValue } from 'svelte/elements';
	import { cn } from '$lib/utils';
	import IconButton from '../ui/IconButton.svelte';
	import { openSearch } from './search-state.svelte';

	interface Props {
		variant?: 'sidebar' | 'icon';
		class?: ClassValue;
	}

	const { variant = 'sidebar', class: className }: Props = $props();

	// Resolved after mount so SSR output is deterministic (no hydration mismatch).
	let isMac = $state(false);
	onMount(() => {
		isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform);
	});
</script>

{#if variant === 'icon'}
	<IconButton
		aria-label="Search"
		title="Search"
		class={cn('size-8 rounded-md border border-border bg-transparent text-text', className)}
		onclick={openSearch}
	>
		<Search class="size-4" />
	</IconButton>
{:else}
	<button
		type="button"
		class={cn(
			'flex w-full cursor-pointer items-center gap-2 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm text-text/60 transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
			className
		)}
		onclick={openSearch}
	>
		<Search class="size-4" />
		<span>Search</span>
		<kbd
			class="ml-auto rounded border border-border px-1.5 py-0.5 font-sans text-[0.65rem] text-text/60"
		>
			<span class="sr-only">{isMac ? 'Command K' : 'Ctrl K'}</span>
			<span class="flex items-center gap-0.5" aria-hidden="true">
				{#if isMac}<Command class="size-3" />{:else}Ctrl{/if}
				<span>K</span>
			</span>
		</kbd>
	</button>
{/if}
