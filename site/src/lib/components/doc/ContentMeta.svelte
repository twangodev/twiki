<script lang="ts">
	import PublicationBadge from './PublicationBadge.svelte';
	import type { PagePublication } from '$lib/types';
	import type { ContentAuthor } from '$lib/metadata';
	interface Props {
		modified?: string;
		published?: string;
		author?: ContentAuthor;
		curated?: boolean;
		/** Reading time in minutes. */
		readingTime?: number;
		publication?: PagePublication;
	}

	const {
		modified,
		published,
		author,
		curated = false,
		readingTime,
		publication
	}: Props = $props();
	const publishedLabel = $derived(
		published
			? new Date(published).toLocaleDateString('en-US', {
					year: 'numeric',
					month: 'short',
					day: 'numeric',
					timeZone: 'UTC'
				})
			: undefined
	);

	const formatted = $derived(
		modified
			? new Date(modified).toLocaleDateString('en-US', {
					year: 'numeric',
					month: 'short',
					day: 'numeric',
					timeZone: 'UTC'
				})
			: undefined
	);
</script>

{#if formatted || readingTime || publication}
	<p class="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-muted">
		{#if author}
			<span
				>{curated ? 'Curated by' : 'By'}
				{#if author.url}<a href={author.url} rel="author">{author.name}</a>{:else}{author.name}{/if}
			</span>
		{/if}
		{#if publishedLabel}<span>Published: <time datetime={published}>{publishedLabel}</time></span
			>{/if}
		{#if formatted}<span>Last modified: <time datetime={modified}>{formatted}</time></span>{/if}
		{#if formatted && readingTime}<span aria-hidden="true"> · </span>{/if}
		{#if readingTime}<span>{readingTime} min read</span>{/if}
		{#if publication}<PublicationBadge {publication} />{/if}
	</p>
{/if}
