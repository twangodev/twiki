<script lang="ts">
	import { Moon, Sun } from '@lucide/svelte';
	import { mode, toggleMode } from 'mode-watcher';
	import IconButton from './IconButton.svelte';
	import type { ClassValue } from 'svelte/elements';

	let { class: className }: { class?: ClassValue } = $props();
</script>

<IconButton
	onclick={toggleMode}
	aria-label="Toggle dark mode"
	title="Toggle theme"
	class={className}
>
	{#if mode.current === 'dark'}
		<Sun class="size-4" />
	{:else}
		<Moon class="size-4" />
	{/if}
</IconButton>
