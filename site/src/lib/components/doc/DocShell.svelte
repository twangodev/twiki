<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { Menu } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import type { NavNode } from '$lib/types';
	import { site } from '$lib/config';
	import { ThemeToggle } from '$lib/components/ui';
	import DocPager from './DocPager.svelte';
	import Sidebar from './Sidebar.svelte';
	import Toc from './Toc.svelte';

	interface Props {
		nav: NavNode[];
		children: Snippet;
	}

	const { nav, children }: Props = $props();

	let mobileNavOpen = $state(false);

	afterNavigate(() => {
		mobileNavOpen = false;
	});
</script>

<div
	class="mx-auto grid min-h-screen max-w-[90rem] grid-cols-[16rem_minmax(0,1fr)_14rem] max-[1100px]:grid-cols-[16rem_minmax(0,1fr)] max-[768px]:grid-cols-[minmax(0,1fr)] max-[768px]:grid-rows-[auto_1fr]"
>
	<header
		class="sticky top-0 z-30 hidden items-center gap-3 border-b border-border bg-bg px-4 py-2 max-[768px]:flex"
	>
		<button
			class="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-transparent text-text transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
			type="button"
			aria-label="Toggle navigation"
			aria-expanded={mobileNavOpen}
			onclick={() => (mobileNavOpen = !mobileNavOpen)}
		>
			<Menu class="size-5" />
		</button>
		<a class="font-bold text-text no-underline" href="/">{site.name}</a>
		<div class="ml-auto flex items-center gap-1">
			<ThemeToggle class="size-8" />
		</div>
	</header>

	<aside
		class={[
			'sticky top-0 h-screen border-r border-border bg-bg max-[768px]:fixed max-[768px]:top-0 max-[768px]:left-0 max-[768px]:z-50 max-[768px]:w-[17rem] max-[768px]:max-w-[85vw] max-[768px]:transition-transform max-[768px]:duration-200',
			mobileNavOpen ? 'max-[768px]:translate-x-0' : 'max-[768px]:-translate-x-full'
		]}
	>
		<Sidebar {nav} />
	</aside>

	{#if mobileNavOpen}
		<button
			class="fixed inset-0 z-40 cursor-pointer border-0 bg-black/40 min-[769px]:hidden"
			type="button"
			aria-label="Close navigation"
			onclick={() => (mobileNavOpen = false)}
		></button>
	{/if}

	<main class="min-w-0 px-10 pt-8 pb-16 max-[768px]:px-5 max-[768px]:pt-6 max-[768px]:pb-12">
		<div class="mx-auto max-w-3xl">
			{@render children()}
			<DocPager {nav} />
		</div>
	</main>

	<aside class="px-4 py-8 max-[1100px]:hidden">
		<Toc />
	</aside>
</div>
