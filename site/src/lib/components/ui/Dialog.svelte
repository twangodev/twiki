<script lang="ts">
	import { Dialog } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		children: Snippet;
	}

	let { open = $bindable(false), onOpenChange, children }: Props = $props();
</script>

<Dialog.Root bind:open {onOpenChange}>
	<Dialog.Portal>
		{@render children()}
	</Dialog.Portal>
</Dialog.Root>
