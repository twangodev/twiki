<script lang="ts">
	import type { NavNode } from '$lib/types';
	import { site } from '$lib/config';
	import { ThemeToggle } from '$lib/components/ui';
	import NavTree from './NavTree.svelte';
	import ReaderModeToggle from './ReaderModeToggle.svelte';

	interface Props {
		nav: NavNode[];
	}

	const { nav }: Props = $props();
</script>

<div class="flex h-full flex-col gap-4 overflow-y-auto px-4 py-5">
	<a
		class="text-[1.05rem] font-bold tracking-[-0.01em] text-[color:var(--color-fg,#111827)] no-underline"
		href="/">{site.name}</a
	>
	<nav class="flex-1" aria-label="Documentation">
		<NavTree nodes={nav} />
	</nav>
	<div
		class="flex items-center justify-between border-t [border-top-color:var(--color-border,#e5e7eb)] pt-3"
	>
		<ThemeToggle />
		<ReaderModeToggle />
	</div>
</div>
