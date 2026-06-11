<script lang="ts">
	import './layout.css';
	import type { Snippet } from 'svelte';
	import { ModeWatcher } from 'mode-watcher';
	import SEO from '$lib/components/SEO.svelte';

	interface Props {
		children: Snippet;
	}

	const { children }: Props = $props();
</script>

<svelte:head><link rel="icon" href="/favicon.png" /></svelte:head>
<SEO />
<ModeWatcher defaultMode="dark" />

{@render children()}
