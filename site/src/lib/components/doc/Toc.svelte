<script lang="ts">
	import { tocState } from './toc.svelte';

	const items = $derived(tocState.items);
	const levelPadding = ['pl-3', 'pl-6', 'pl-9', 'pl-12', 'pl-[3.75rem]'];

	function itemPadding(level: number) {
		const index = Math.max(0, Math.min(level - 2, levelPadding.length - 1));
		return levelPadding[index];
	}
</script>

{#if items.length > 0}
	<nav class="sticky top-20 text-[0.8125rem]" aria-label="On this page">
		<p
			class="m-[0_0_0.5rem] text-[0.7rem] font-bold tracking-[0.08em] text-[color:var(--color-fg-muted,#9ca3af)] uppercase"
		>
			On this page
		</p>
		<ul class="m-0 list-none border-l [border-left-color:var(--color-border,#e5e7eb)] p-0">
			{#each items as item (item.id)}
				<li class={itemPadding(item.level)}>
					<a
						class="block py-[0.2rem] leading-[1.35] text-[color:var(--color-fg-muted,#6b7280)] no-underline hover:text-[color:var(--color-accent,#d35545)]"
						href={`#${item.id}`}>{item.text}</a
					>
				</li>
			{/each}
		</ul>
	</nav>
{/if}
