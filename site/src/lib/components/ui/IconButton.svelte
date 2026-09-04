<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	type Props = HTMLButtonAttributes & {
		'aria-label': string;
		active?: boolean;
		children: Snippet;
	};

	let { class: className, active = false, children, type = 'button', ...rest }: Props = $props();
</script>

<button
	{type}
	class={cn(
		'inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
		active && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
		className
	)}
	{...rest}
>
	{@render children()}
</button>
