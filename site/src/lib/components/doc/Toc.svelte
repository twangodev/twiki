<script lang="ts">
	import { page } from '$app/state';
	import type { TocEntry } from '$lib/types';

	// The catch-all page load returns a normalized `toc: TocEntry[]`; reading it
	// from page.data (instead of a client-side store) means the TOC rail is in
	// the prerendered HTML, matching the live Quartz site.
	const items = $derived((page.data.toc as TocEntry[] | undefined) ?? []);
	type TocNode = TocEntry & { children: TocNode[] };
	const tree = $derived.by(() => {
		const roots: TocNode[] = [];
		const parents: TocNode[] = [];
		for (const item of items) {
			const node: TocNode = { ...item, children: [] };
			while (parents.length && parents[parents.length - 1].level >= item.level) {
				parents.pop();
			}
			(parents.at(-1)?.children ?? roots).push(node);
			parents.push(node);
		}
		return roots;
	});
</script>

{#snippet branches(nodes: TocNode[], nested = false)}
	<ul class="toc-branches" class:nested>
		{#each nodes as item (item.id)}
			<li>
				<a class:parent={item.children.length > 0} href={`#${item.id}`}>{item.text}</a>
				{#if item.children.length}
					{@render branches(item.children, true)}
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

{#if items.length > 0}
	<nav class="text-[0.8125rem]" aria-label="On this page">
		<p
			class="m-[0_0_0.5rem] text-[0.7rem] font-bold tracking-[0.08em] text-[color:var(--color-fg-muted,#9ca3af)] uppercase"
		>
			On this page
		</p>
		{@render branches(tree)}
	</nav>
{/if}

<style>
	.toc-branches {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.toc-branches.nested {
		margin: 0.125rem 0 0.375rem 0.375rem;
		padding-left: 0.75rem;
		border-left: 1px solid var(--color-border);
	}
	a {
		display: block;
		border-radius: 0.25rem;
		padding: 0.25rem 0.375rem;
		color: var(--color-muted);
		line-height: 1.4;
		overflow-wrap: anywhere;
		text-decoration: none;
		transition:
			color 120ms,
			background-color 120ms;
	}
	a.parent {
		font-weight: 500;
		color: var(--color-text);
	}
	a:hover,
	a:focus-visible {
		color: var(--color-accent);
		background: var(--color-surface);
	}
	a:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}
</style>
