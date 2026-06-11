<script lang="ts">
	// Backlinks panel (data-only render for now; the Islands phase owns the
	// final styling/interaction — keep the structure + data attributes stable).
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
	<section class="mt-12 border-t border-border pt-6" data-island="backlinks" aria-label="Backlinks">
		<h2 class="m-0 mb-3 text-sm font-semibold tracking-[0.05em] text-muted uppercase">
			Linked to this page
		</h2>
		<ul class="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-1 p-0 max-[640px]:grid-cols-1">
			{#each backlinks as link (link.slug)}
				<li class="min-w-0">
					<a
						class="block truncate rounded-md px-2 py-1 text-sm text-muted no-underline hover:bg-surface hover:text-accent"
						href={href(link.slug)}>{link.title}</a
					>
				</li>
			{/each}
		</ul>
	</section>
{/if}
