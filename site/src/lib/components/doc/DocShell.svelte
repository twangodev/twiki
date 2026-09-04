<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { Menu } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import type { NavNode } from '$lib/types';
	import { site } from '$lib/config';
	import { ThemeToggle } from '$lib/components/ui';
	import { SearchButton, SearchPalette } from '$lib/components/search';
	import GraphPanel from '$lib/components/graph/GraphPanel.svelte';
	import DocPager from './DocPager.svelte';
	import ReaderModeToggle from './ReaderModeToggle.svelte';
	import Sidebar from './Sidebar.svelte';
	import Toc from './Toc.svelte';
	import { readerMode } from './reader-mode.svelte';

	interface Props {
		nav: NavNode[];
		children: Snippet;
	}

	const { nav, children }: Props = $props();

	let mobileNavOpen = $state(false);
	type RailPageData = { kind?: string };
	const railPageData = $derived(page.data as RailPageData);
	const showContentRail = $derived(railPageData.kind === 'page');

	afterNavigate(() => {
		mobileNavOpen = false;
	});
</script>

<div class={['doc-shell mx-auto min-h-screen', readerMode.enabled && 'doc-shell-reader']}>
	<header
		class="doc-mobile-header sticky top-0 z-30 hidden items-center gap-3 border-b border-border bg-bg px-4 py-2 max-[800px]:flex"
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
			<SearchButton variant="icon" class="size-8" /><SearchPalette />
			<ReaderModeToggle class="size-8" />
			<ThemeToggle class="size-8" />
		</div>
	</header>

	<aside
		class={[
			'doc-sidebar-left sticky top-0 h-screen border-r border-border bg-bg max-[800px]:fixed max-[800px]:top-0 max-[800px]:left-0 max-[800px]:z-50 max-[800px]:w-[17rem] max-[800px]:max-w-[85vw] max-[800px]:transition-transform max-[800px]:duration-200',
			readerMode.enabled && 'hidden max-[800px]:block',
			mobileNavOpen ? 'max-[800px]:translate-x-0' : 'max-[800px]:-translate-x-full'
		]}
	>
		<Sidebar {nav} />
	</aside>

	{#if readerMode.enabled}
		<!-- floating controls so reader mode can be exited once the rails are gone -->
		<div
			class="fixed top-3 right-3 z-30 flex items-center gap-1 rounded-lg border border-border bg-bg/90 p-1 backdrop-blur max-[800px]:hidden"
		>
			<ReaderModeToggle class="size-8" />
			<ThemeToggle class="size-8" />
		</div>
	{/if}

	{#if mobileNavOpen}
		<button
			class="fixed inset-0 z-40 cursor-pointer border-0 bg-black/40 min-[801px]:hidden"
			type="button"
			aria-label="Close navigation"
			onclick={() => (mobileNavOpen = false)}
		></button>
	{/if}

	<main
		class="doc-main min-w-0 px-10 pt-8 pb-16 max-[800px]:px-5 max-[800px]:pt-6 max-[800px]:pb-12"
	>
		<div class="mx-auto max-w-3xl">
			{@render children()}
			<DocPager {nav} />
		</div>
	</main>

	{#if !readerMode.enabled}
		<aside class="doc-sidebar-right">
			{#if showContentRail}
				<div class="doc-sidebar-right-inner">
					<GraphPanel />
					<div class="doc-toc"><Toc /></div>
				</div>
			{/if}
		</aside>
	{/if}
</div>
