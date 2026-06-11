<script lang="ts">
	import { cn } from '$lib/utils';
	import { Dialog } from 'bits-ui';
	import { scale } from 'svelte/transition';
	import type { ClassValue } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	interface Props {
		class?: ClassValue;
		children: Snippet;
	}

	let { class: className, children }: Props = $props();
</script>

<Dialog.Content forceMount>
	{#snippet child({ props, open })}
		{#if open}
			<div
				{...props}
				transition:scale={{ duration: 150, start: 0.95, opacity: 0 }}
				class={cn(
					'fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-subtle bg-bg p-5 shadow-2xl',
					className
				)}
			>
				{@render children()}
			</div>
		{/if}
	{/snippet}
</Dialog.Content>
