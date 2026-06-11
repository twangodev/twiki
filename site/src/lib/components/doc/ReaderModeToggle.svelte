<script lang="ts">
	import { BookOpen } from '@lucide/svelte';
	import { cn } from '$lib/utils';
	import type { ClassValue } from 'svelte/elements';
	import { readerMode } from './reader-mode.svelte';

	let { class: className }: { class?: ClassValue } = $props();
</script>

<button
	type="button"
	onclick={() => readerMode.toggle()}
	aria-label="Toggle reader mode"
	aria-pressed={readerMode.enabled}
	title="Toggle reader mode"
	class={cn(
		'inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
		readerMode.enabled && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
		className
	)}
>
	<BookOpen class="size-4" />
</button>
