<script lang="ts">
	// Backlinks panel — pages that link to the current one. This lives after
	// the graph and TOC in the right rail, matching Quartz's component order.
	import type { BacklinkRef } from '$lib/types';

	interface Props {
		backlinks: BacklinkRef[];
	}

	const { backlinks }: Props = $props();

	/** Backlink slugs are display-form: '/' = home, folder pages end in '/'. */
	function href(slug: string): string {
		if (slug === '/') return '/';
		return '/' + slug.replace(/\/$/, '');
	}
</script>

{#if backlinks.length > 0}
	<section class="backlinks flex min-w-0 flex-col" data-island="backlinks" aria-label="Backlinks">
		<h3 class="m-0 text-base font-semibold text-text">Backlinks</h3>
		<ul class="my-2 max-h-[22rem] list-none overflow-y-auto p-0 text-sm">
			{#each backlinks as link (link.slug)}
				<li class="min-w-0 py-0.5">
					<a
						class="block truncate font-medium text-accent no-underline hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
						href={href(link.slug)}>{link.title}</a
					>
				</li>
			{/each}
		</ul>
	</section>
{/if}
