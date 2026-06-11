<script lang="ts">
	import './layout.css';
	import type { Snippet } from 'svelte';
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
</script>

<svelte:head><link rel="icon" href="/favicon.png" /></svelte:head>
<ModeWatcher defaultMode="dark" />

<DocShell {nav}>
	{@render children()}
</DocShell>
