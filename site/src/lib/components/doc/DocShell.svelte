<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { Menu } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import type { NavNode } from '$lib/types';
	import { site } from '$lib/config';
	import { ThemeToggle } from '$lib/components/ui';
	import IconButton from '../ui/IconButton.svelte';
	import { SearchButton, SearchPalette } from '$lib/components/search';
	import GraphPanel from '$lib/components/graph/GraphPanel.svelte';
	import DocPager from './DocPager.svelte';
	import ReaderModeToggle from './ReaderModeToggle.svelte';
	import Sidebar from './Sidebar.svelte';
	import Toc from './Toc.svelte';
	import { readerMode } from './reader-mode.svelte';
	import { createHeadingTracker } from './heading-tracker.svelte';

	interface Props {
		nav: NavNode[];
		children: Snippet;
	}

	const { nav, children }: Props = $props();

	let mobileNavOpen = $state(false);
	type RailPageData = { kind?: string };
	const railPageData = $derived(page.data as RailPageData);
	const showContentRail = $derived(railPageData.kind === 'page');
	const heading = createHeadingTracker(() => page.data.toc ?? []);

	afterNavigate(() => {
		mobileNavOpen = false;
	});
</script>

<div
	class={[
		'doc-shell min-h-screen',
		!showContentRail && 'doc-shell-listing',
		readerMode.enabled && 'doc-shell-reader'
	]}
>
	<header
		class="doc-mobile-header sticky top-0 z-30 items-center gap-3 border-b border-border bg-bg px-4 py-2"
	>
		<IconButton
			class="size-8 rounded-md border border-border bg-transparent text-text"
			aria-label="Toggle navigation"
			aria-expanded={mobileNavOpen}
			onclick={() => (mobileNavOpen = !mobileNavOpen)}
		>
			<Menu class="size-5" />
		</IconButton>
		<a class="font-bold text-text no-underline" href="/">{site.name}</a>
		<div class="ml-auto flex items-center gap-1">
			<SearchButton variant="icon" class="size-8" />
			<ReaderModeToggle class="size-8" />
			<ThemeToggle class="size-8" />
		</div>
	</header>

	<aside class={['doc-sidebar-left border-r border-border bg-bg', mobileNavOpen && 'doc-nav-open']}>
		<Sidebar {nav} />
	</aside>

	{#if readerMode.enabled}
		<!-- floating controls so reader mode can be exited once the rails are gone -->
		<div
			class="doc-reader-controls fixed top-3 right-3 z-30 flex items-center gap-1 rounded-lg border border-border bg-bg/90 p-1 backdrop-blur"
		>
			<ReaderModeToggle class="size-8" />
			<ThemeToggle class="size-8" />
		</div>
	{/if}

	{#if mobileNavOpen}
		<button
			class="doc-nav-backdrop fixed inset-0 z-40 cursor-pointer border-0 bg-black/40"
			type="button"
			aria-label="Close navigation"
			onclick={() => (mobileNavOpen = false)}
		></button>
	{/if}

	<main class="doc-main min-w-0">
		<div class={railPageData.kind === 'file-browser' ? 'w-full' : 'mx-auto max-w-3xl'}>
			{@render children()}
			<DocPager {nav} />
		</div>
	</main>

	{#if !readerMode.enabled && showContentRail}
		<aside class="doc-sidebar-right" aria-label="Page tools">
			<div class="doc-sidebar-right-inner">
				<GraphPanel />
				{#if (page.data.toc?.length ?? 0) > 0}
					<details class="doc-compact-outline">
						<summary class="cursor-pointer text-sm text-muted">On this page</summary>
						<Toc active={heading.active} />
					</details>
				{/if}
				<div class="doc-toc"><Toc active={heading.active} /></div>
			</div>
		</aside>
	{/if}
</div>
<SearchPalette />
