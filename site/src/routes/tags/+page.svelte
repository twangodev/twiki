<script lang="ts">
	import SEO from '$lib/components/SEO.svelte';
	import Breadcrumbs from '$lib/components/doc/Breadcrumbs.svelte';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	const { data }: Props = $props();
</script>

<SEO title="Tag Index" canonical="/tags" />

<Breadcrumbs route="tags" current="Tag Index" />

<article class="prose dark:prose-invert max-w-none">
	<h1>Tag Index</h1>
	<p class="text-muted">Found {data.tags.length} total tags.</p>
</article>

<ul class="m-0 mt-4 flex list-none flex-wrap gap-2 p-0">
	{#each data.tags as { tag, count } (tag)}
		<li>
			<a
				class="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-sm text-text no-underline transition-colors hover:border-accent hover:text-accent"
				href={`/tags/${tag}`}
			>
				<span>{tag}</span>
				<span class="text-xs text-muted">{count}</span>
			</a>
		</li>
	{/each}
</ul>
