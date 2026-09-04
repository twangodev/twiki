<script lang="ts">
	// ContentMeta: last-modified date + reading time (Quartz parity).
	interface Props {
		/** ISO date string (frontmatter date -> submodule git log -> fs). */
		modified?: string;
		/** Reading time in minutes. */
		readingTime?: number;
	}

	const { modified, readingTime }: Props = $props();

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

{#if formatted || readingTime}
	<p class="m-0 text-[0.8125rem] text-muted">
		{#if formatted}<span>Last modified: {formatted}</span>{/if}
		{#if formatted && readingTime}<span aria-hidden="true"> · </span>{/if}
		{#if readingTime}<span>{readingTime} min read</span>{/if}
	</p>
{/if}
