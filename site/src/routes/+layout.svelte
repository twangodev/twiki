<script lang="ts">
	import 'katex/dist/katex.min.css';
	import './layout.css';
	import { onMount, setContext, type Snippet } from 'svelte';
	import { dev } from '$app/environment';
	import { invalidate, invalidateAll } from '$app/navigation';
	import { ModeWatcher } from 'mode-watcher';
	import { site } from '$lib/config';
	import { invalidateGraph } from '$lib/components/graph/graph-data';
	import DocShell from '$lib/components/doc/DocShell.svelte';
	import type { LayoutData } from './$types';

	interface Props {
		children: Snippet;
		data: LayoutData;
	}

	const { children, data }: Props = $props();
	const nav = $derived(data.nav ?? []);
	setContext('wisconsin-file-icons', () => data.fileIcons);
	setContext('twiki:content-version', () => `${data.edition}:${data.contentVersion}`);

	onMount(() => {
		if (dev) return;
		void import('$lib/analytics')
			.then(({ initializeAnalytics }) => initializeAnalytics())
			.catch((error) => console.warn('Failed to initialize analytics', error));
	});

	if (import.meta.hot) {
		const refreshContent = ({
			recovered,
			layoutChanged,
			graphChanged
		}: {
			recovered: boolean;
			layoutChanged?: boolean;
			graphChanged?: boolean;
		}) => {
			if (recovered || graphChanged !== false) invalidateGraph();
			if (recovered) document.querySelector('vite-error-overlay')?.remove();
			void (recovered || layoutChanged !== false ? invalidateAll() : invalidate('twiki:content'));
		};
		import.meta.hot.on('wisconsin:content', refreshContent);
		import.meta.hot.dispose(() => import.meta.hot?.off('wisconsin:content', refreshContent));
	}
</script>

<svelte:head>
	<link rel="icon" type="image/x-icon" href="/favicon.ico" />
	<link
		rel="alternate"
		type="application/rss+xml"
		title={`${site.title} — recent notes`}
		href="/index.xml"
	/>
</svelte:head>
<ModeWatcher defaultMode="system" />

<DocShell {nav}>
	{@render children()}
</DocShell>
