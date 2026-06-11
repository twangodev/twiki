<script lang="ts">
	import { cn } from '$lib/utils';
	import { Dialog } from 'bits-ui';
	import { fade } from 'svelte/transition';
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		class?: ClassValue;
	}

	let { class: className }: Props = $props();
</script>

<Dialog.Overlay forceMount>
	{#snippet child({ props, open })}
		{#if open}
			<div
				{...props}
				transition:fade={{ duration: 150 }}
				class={cn('fixed inset-0 z-50 bg-black/60 backdrop-blur-sm', className)}
			></div>
		{/if}
	{/snippet}
</Dialog.Overlay>
