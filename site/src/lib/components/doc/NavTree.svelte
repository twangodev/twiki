<script lang="ts">
	import type { NavNode } from '$lib/types';
	import Self from './NavTree.svelte';
	import { page } from '$app/state';
	import { ChevronRight } from '@lucide/svelte';
	import { cn } from '$lib/utils';

	interface Props {
		nodes: NavNode[];
		/** Nesting depth, used for indentation. */
		depth?: number;
	}

	const { nodes, depth = 0 }: Props = $props();

	const currentPath = $derived(normalize(page.url.pathname));

	/** trailingSlash is 'never' on this site: compare routes without it. */
	function normalize(p: string): string {
		if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
		return p;
	}

	function isActive(route: string | undefined): boolean {
		return !!route && normalize(route) === currentPath;
	}

	/** A section is "open" if it contains the active route (or its own route). */
	function containsActive(node: NavNode): boolean {
		if (isActive(node.route)) return true;
		return node.children.some(containsActive);
	}

	const navItemClass = 'm-0';
	const navRowClass = 'rounded-md px-2 py-[0.3rem] text-sm leading-[1.35] no-underline';
	const navLinkBase = cn('block', navRowClass, 'text-muted hover:bg-surface hover:text-text');
	const activeNavLinkClass =
		'bg-[color:var(--color-accent-soft,#f7e4e1)] font-semibold text-accent';
	const sectionLabelClass = cn('block font-semibold text-text', navRowClass);
	const summaryClass = cn(
		'flex cursor-pointer list-none items-center gap-1.5 font-semibold text-text hover:bg-surface [&::-webkit-details-marker]:hidden',
		navRowClass
	);
</script>

<ul class={cn('m-0 list-none p-0', depth > 0 && 'ml-3 border-l border-border pl-1')}>
	{#each nodes as node (node.segment)}
		<li class={navItemClass}>
			{#if node.children.length > 0}
				<details class="group/nav-section" open={containsActive(node)}>
					<summary class={summaryClass}>
						<ChevronRight
							class="size-4 shrink-0 text-muted transition-transform group-open/nav-section:rotate-90"
							strokeWidth={2.5}
							aria-hidden="true"
						/>
						{#if node.route}
							<a
								class={cn(
									'inline p-0 font-semibold no-underline',
									isActive(node.route) ? 'text-accent' : 'text-text'
								)}
								href={node.route}>{node.title}</a
							>
						{:else}
							<span class="inline p-0 font-semibold text-text">{node.title}</span>
						{/if}
					</summary>
					<Self nodes={node.children} depth={depth + 1} />
				</details>
			{:else if node.route}
				<a
					class={cn(navLinkBase, isActive(node.route) && activeNavLinkClass)}
					href={node.route}
					aria-current={isActive(node.route) ? 'page' : undefined}>{node.title}</a
				>
			{:else}
				<span class={sectionLabelClass}>{node.title}</span>
			{/if}
		</li>
	{/each}
</ul>
