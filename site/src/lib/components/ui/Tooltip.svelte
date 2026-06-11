<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		text: string;
		children: Snippet;
	}

	let { text, children }: Props = $props();
</script>

<Tooltip.Provider>
	<Tooltip.Root>
		<Tooltip.Trigger
			class="inline-flex cursor-default items-center"
			onclick={(e) => e.preventDefault()}
		>
			{@render children()}
		</Tooltip.Trigger>
		<Tooltip.Portal>
			<Tooltip.Content
				sideOffset={4}
				class="z-50 max-w-xs rounded border border-subtle bg-bg px-3 py-1.5 font-mono text-xs text-muted shadow-lg duration-150 animate-in fade-in-0"
			>
				{text}
				<Tooltip.Arrow class="border-subtle fill-bg" />
			</Tooltip.Content>
		</Tooltip.Portal>
	</Tooltip.Root>
</Tooltip.Provider>
