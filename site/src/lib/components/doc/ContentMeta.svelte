<script lang="ts">
	import PublicationBadge from './PublicationBadge.svelte';
	import type { PagePublication } from '$lib/types';
	interface Props {
		/** ISO date string (frontmatter date -> submodule git log -> fs). */
		modified?: string;
		/** Reading time in minutes. */
		readingTime?: number;
		publication?: PagePublication;
	}

	const { modified, readingTime, publication }: Props = $props();

	const formatted = $derived(
		modified
			? new Date(modified).toLocaleDateString('en-US', {
					year: 'numeric',
					month: 'short',
					day: 'numeric'
				})
			: undefined
	);
</script>

{#if formatted || readingTime || publication}
	<p class="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-muted">
		{#if formatted}<span>Last modified: {formatted}</span>{/if}
		{#if formatted && readingTime}<span aria-hidden="true"> · </span>{/if}
		{#if readingTime}<span>{readingTime} min read</span>{/if}
		{#if publication}<PublicationBadge {publication} />{/if}
	</p>
{/if}
