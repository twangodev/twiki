<script lang="ts">
	import { Folder, FileText } from '@lucide/svelte';
	import SEO from '$lib/components/SEO.svelte';
	import Backlinks from '$lib/components/doc/Backlinks.svelte';
	import Breadcrumbs from '$lib/components/doc/Breadcrumbs.svelte';
	import ContentMeta from '$lib/components/doc/ContentMeta.svelte';
	import { enhanceArticle } from '$lib/components/doc/enhancements';
	import { linkPopovers } from '$lib/components/popover';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	const { data }: Props = $props();

	const canonical = $derived(data.route === '' ? '/' : `/${data.route}`);

	// Pagefind inline filters: course = first route segment, plus page tags.
	// data-pagefind-filter parses comma-separated `key:value` pairs; corpus tag
	// values are comma-free (checked against content-manifest.json).
	const pagefindFilter = $derived.by(() => {
		if (data.route === '') return undefined;
		const parts = [`course:${data.route.split('/')[0]}`];
		if (data.kind === 'page') parts.push(...data.page.tags.map((t) => `tag:${t}`));
		return parts.join(', ');
	});

	function shortDate(iso?: string): string {
		return iso
			? new Date(iso).toLocaleDateString('en-US', {
					year: 'numeric',
					month: 'short',
					day: 'numeric'
				})
			: '';
	}
</script>

{#if data.kind === 'page'}
	<SEO
		title={data.route === '' ? undefined : data.page.title}
		description={data.page.description}
		{canonical}
		type="article"
	/>

	<Breadcrumbs route={data.route} current={data.page.title} />

	<article
		class="prose dark:prose-invert max-w-none"
		data-pagefind-body
		data-pagefind-filter={pagefindFilter}
		{@attach enhanceArticle(data.route)}
		{@attach linkPopovers(data.route)}
	>
		{#if data.route !== ''}
			<!-- Frontmatter title beats Pagefind's h1-scraping (some pages lack an h1). -->
			<span class="sr-only" data-pagefind-meta="title">{data.page.title}</span>
			<div data-pagefind-ignore>
				<ContentMeta modified={data.page.dates?.modified} readingTime={data.page.readingTime} />
			</div>
		{/if}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- build-time rendered, trusted corpus -->
		{@html data.page.html}
	</article>

	<Backlinks backlinks={data.page.backlinks} />
{:else}
	<SEO title={data.listing.name} {canonical} />

	<Breadcrumbs route={data.route} current={data.listing.name} />

	<article
		class="prose dark:prose-invert max-w-none"
		data-pagefind-body
		data-pagefind-filter={pagefindFilter}
	>
		<h1>{data.listing.name}</h1>
		<p class="text-muted">
			{data.listing.pageCount}
			{data.listing.pageCount === 1 ? 'item' : 'items'} under this folder.
		</p>
	</article>

	<ul class="m-0 mt-4 list-none p-0">
		{#each data.listing.entries as entry (entry.route)}
			<li>
				<a
					class="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-text no-underline hover:bg-surface"
					href={entry.route}
				>
					{#if entry.isFolder}
						<Folder class="size-4 shrink-0 text-muted" aria-hidden="true" />
					{:else}
						<FileText class="size-4 shrink-0 text-muted" aria-hidden="true" />
					{/if}
					<span class="min-w-0 flex-1 truncate font-medium">{entry.title}</span>
					{#if entry.modified}
						<span class="shrink-0 text-xs text-muted">{shortDate(entry.modified)}</span>
					{/if}
				</a>
			</li>
		{/each}
	</ul>
{/if}
