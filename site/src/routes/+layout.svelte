<script lang="ts">
	import 'katex/dist/katex.min.css';
	import './layout.css';
	import type { Snippet } from 'svelte';
	import { onNavigate } from '$app/navigation';
	import { ModeWatcher } from 'mode-watcher';
	import DocShell from '$lib/components/doc/DocShell.svelte';
	import type { NavNode } from '$lib/types';
	// Static import (emitted by scripts/prepare-static.ts): the Explorer tree
	// ships once in a shared JS chunk instead of being serialized into every
	// prerendered page's data payload (~60 kB x ~960 pages).
	import navData from '$lib/generated/nav.json';

	interface Props {
		children: Snippet;
	}

	const { children }: Props = $props();
	const nav = navData as NavNode[];

	// Subtle crossfade between pages via the View Transitions API
	// (https://svelte.dev/blog/view-transitions). Progressive enhancement:
	// no-ops in browsers without document.startViewTransition, and skipped
	// for users who prefer reduced motion. Duration is tuned in layout.css.
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});
</script>

<svelte:head><link rel="icon" href="/favicon.png" /></svelte:head>
<ModeWatcher defaultMode="system" />

<DocShell {nav}>
	{@render children()}
</DocShell>
