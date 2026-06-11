<script lang="ts">
	import { Moon, Sun } from '@lucide/svelte';
	import { mode, toggleMode } from 'mode-watcher';
	import { cn } from '$lib/utils';
	import type { ClassValue } from 'svelte/elements';

	let { class: className }: { class?: ClassValue } = $props();
</script>

<button
	type="button"
	onclick={toggleMode}
	aria-label="Toggle dark mode"
	title="Toggle theme"
	class={cn(
		'inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
		className
	)}
>
	{#if mode.current === 'dark'}
		<Sun class="size-4" />
	{:else}
		<Moon class="size-4" />
	{/if}
</button>
