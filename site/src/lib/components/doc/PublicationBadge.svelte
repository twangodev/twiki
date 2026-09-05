<script lang="ts">
	import { Globe, Lock } from '@lucide/svelte';
	import { Tooltip } from 'bits-ui';
	import type { PagePublication } from '$lib/types';

	const { publication }: { publication: PagePublication } = $props();
	const label = $derived(publication.public ? 'Public' : 'Private');
	const description = $derived(
		publication.reason ??
			(publication.public ? 'Available to everyone.' : 'Only available to approved users.')
	);
</script>

<Tooltip.Provider delayDuration={200}>
	<Tooltip.Root>
		<Tooltip.Trigger
			class={[
				'inline-flex cursor-help items-center gap-1 rounded-full border-0 bg-surface px-2 py-0.5 text-[0.6875rem] leading-4 font-medium ring-1 ring-inset ring-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
				publication.public && 'text-accent'
			]}
			aria-label={`Page visibility: ${label}`}
		>
			{#if publication.public}<Globe size={12} aria-hidden="true" />{:else}<Lock
					size={12}
					aria-hidden="true"
				/>{/if}
			{label}
		</Tooltip.Trigger>
		<Tooltip.Portal>
			<Tooltip.Content
				role="tooltip"
				side="bottom"
				align="end"
				sideOffset={6}
				collisionPadding={12}
				class="z-50 max-w-[min(22rem,calc(100vw-1.5rem))] rounded-md border border-border bg-surface px-3 py-2 text-xs break-words text-text shadow-sm"
			>
				{description}
			</Tooltip.Content>
		</Tooltip.Portal>
	</Tooltip.Root>
</Tooltip.Provider>
