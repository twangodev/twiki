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
	// Split only a leading H1, retaining its original markup and deep-link id.
	const heading = $derived(
		data.kind === 'page' ? (data.page.html.match(/^\s*<h1\b[^>]*>[\s\S]*?<\/h1>/i)?.[0] ?? '') : ''
	);
	const body = $derived(data.kind === 'page' ? data.page.html.slice(heading.length) : '');

	// Pagefind permits only the final comma-separated filter to use inline
	// `key:value` syntax. Emit one hidden capture element per value instead so
	// course and every tag become independent, repeatable filters.
	const pagefindCourse = $derived.by(() => {
		if (data.route === '') return undefined;
		return data.route.split('/')[0];
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
		{@attach enhanceArticle(data.route)}
		{@attach linkPopovers(data.route)}
	>
		{#if data.route !== ''}
			<div class="hidden" data-pagefind-ignore>
				<span data-pagefind-filter="course">{pagefindCourse}</span>
				{#each data.page.tags as tag (tag)}
					<span data-pagefind-filter="tag">{tag}</span>
				{/each}
			</div>
			<!-- Frontmatter title beats Pagefind's h1-scraping (some pages lack an h1). -->
			<span class="sr-only" data-pagefind-meta="title">{data.page.title}</span>
		{/if}
		{#if heading}
			{@html heading}
		{:else if data.kind === 'page'}
			<h1>{data.page.title}</h1>
		{/if}
		<div class="doc-meta" data-pagefind-ignore>
			<ContentMeta
				modified={data.route ? data.page.dates?.modified : undefined}
				readingTime={data.route ? data.page.readingTime : undefined}
				publication={data.page.publication}
			/>
		</div>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- build-time rendered, trusted corpus -->
		{@html body}
	</article>

	<Backlinks backlinks={data.page.backlinks} />
{:else}
	<SEO title={data.listing.name} {canonical} />

	<Breadcrumbs route={data.route} current={data.listing.name} />

	<article class="prose dark:prose-invert max-w-none" data-pagefind-body>
		{#if pagefindCourse}
			<span class="hidden" data-pagefind-ignore data-pagefind-filter="course">{pagefindCourse}</span
			>
		{/if}
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
