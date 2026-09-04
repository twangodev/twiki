<script lang="ts">
	import { BookOpen } from '@lucide/svelte';
	import IconButton from '../ui/IconButton.svelte';
	import type { ClassValue } from 'svelte/elements';
	import { readerMode } from './reader-mode.svelte';

	let { class: className }: { class?: ClassValue } = $props();
</script>

<IconButton
	onclick={() => readerMode.toggle()}
	aria-label="Toggle reader mode"
	aria-pressed={readerMode.enabled}
	title="Toggle reader mode"
	active={readerMode.enabled}
	class={className}
>
	<BookOpen class="size-4" />
</IconButton>
