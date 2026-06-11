<script lang="ts" module>
	import { cn } from '$lib/utils';
	import type { ClassValue } from 'svelte/elements';

	export type ButtonVariant = 'default' | 'outline' | 'ghost' | 'link' | 'destructive';
	export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'inline';

	export const buttonVariants: Record<ButtonVariant, string> = {
		default: 'bg-accent text-white hover:bg-accent/90',
		outline: 'border border-subtle bg-bg text-text hover:border-muted hover:bg-surface',
		ghost: 'text-muted hover:bg-surface hover:text-text',
		link: 'text-accent underline-offset-4 hover:underline',
		destructive: 'bg-red-600 text-white hover:bg-red-600/90'
	};

	export const buttonSizes: Record<ButtonSize, string> = {
		sm: 'h-8 gap-1.5 px-3 text-xs',
		md: 'h-9 gap-2 px-4 text-sm',
		lg: 'h-10 gap-2 px-5 text-sm',
		icon: 'h-9 w-9',
		inline: 'h-auto gap-1 p-0 text-sm' // bare text (e.g. link-style inline actions)
	};

	const base =
		'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg font-sans font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-50';

	export function buttonClass(
		variant: ButtonVariant,
		size: ButtonSize,
		className?: ClassValue | null
	) {
		return cn(base, buttonVariants[variant], buttonSizes[size], className);
	}
</script>

<script lang="ts">
	import type { WithElementRef } from '$lib/utils';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	type Props = WithElementRef<HTMLButtonAttributes & HTMLAnchorAttributes> & {
		variant?: ButtonVariant;
		size?: ButtonSize;
		href?: string;
		children: Snippet;
	};

	let {
		variant = 'default',
		size = 'md',
		class: className,
		ref = $bindable(null),
		href,
		type,
		children,
		...rest
	}: Props = $props();
</script>

{#if href}
	<a bind:this={ref} {href} class={buttonClass(variant, size, className)} {...rest}>
		{@render children()}
	</a>
{:else}
	<button
		bind:this={ref}
		type={type ?? 'button'}
		class={buttonClass(variant, size, className)}
		{...rest}
	>
		{@render children()}
	</button>
{/if}
