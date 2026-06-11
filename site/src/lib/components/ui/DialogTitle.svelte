<script lang="ts">
	import { cn } from '$lib/utils';
	import { Dialog } from 'bits-ui';
	import type { ClassValue } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	interface Props {
		level?: 1 | 2 | 3 | 4 | 5 | 6;
		class?: ClassValue;
		children: Snippet;
	}

	let { level = 3, class: className, children }: Props = $props();
</script>

<Dialog.Title {level} class={cn('font-sans font-semibold tracking-tight text-text', className)}>
	{@render children()}
</Dialog.Title>
