<script lang="ts">
	import SEO from '$lib/components/SEO.svelte';
	import Breadcrumbs from '$lib/components/doc/Breadcrumbs.svelte';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	const { data }: Props = $props();

	function shortDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}
</script>

<SEO title={`Tag: ${data.tag}`} canonical={`/tags/${data.tag}`} />

<Breadcrumbs route={`tags/${data.tag}`} current={data.tag} />

<article class="prose dark:prose-invert max-w-none">
	<h1>Tag: {data.tag}</h1>
	<p class="text-muted">
		{data.pages.length}
		{data.pages.length === 1 ? 'item' : 'items'} with this tag.
	</p>
</article>

<ul class="m-0 mt-4 list-none space-y-1 p-0">
	{#each data.pages as page (page.route)}
		<li>
			<a class="block rounded-md px-3 py-2 no-underline hover:bg-surface" href={page.route}>
				<span class="flex items-baseline justify-between gap-3">
					<span class="min-w-0 truncate text-sm font-medium text-text">{page.title}</span>
					<span class="shrink-0 text-xs text-muted">{shortDate(page.modified)}</span>
				</span>
				{#if page.description}
					<span class="mt-0.5 line-clamp-1 block text-xs text-muted">{page.description}</span>
				{/if}
			</a>
		</li>
	{/each}
</ul>
