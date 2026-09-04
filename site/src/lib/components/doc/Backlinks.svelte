<script lang="ts">
	// Backlinks panel — pages that link to the current one, styled as
	// cca-aesthetic cards (1px border-border, rounded, surface hover, accent on
	// hover) to match DocPager.
	import { CornerDownRight } from '@lucide/svelte';
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

	/** Parent path of the linking page, shown as context under the title. */
	function context(slug: string): string {
		if (slug === '/') return '';
		const segments = slug.replace(/\/$/, '').split('/');
		return segments.slice(0, -1).join(' / ');
	}
</script>

{#if backlinks.length > 0}
	<section class="mt-12 border-t border-border pt-6" data-island="backlinks" aria-label="Backlinks">
		<h2 class="m-0 mb-3 text-xs font-semibold tracking-[0.08em] text-muted uppercase">
			Linked to this page
		</h2>
		<ul class="m-0 grid list-none grid-cols-2 gap-2 p-0 max-[640px]:grid-cols-1">
			{#each backlinks as link (link.slug)}
				<li class="min-w-0">
					<a
						class="group flex items-center gap-3 rounded-md border border-border px-3 py-2 no-underline transition-colors hover:border-accent hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
						href={href(link.slug)}
					>
						<CornerDownRight
							class="size-4 shrink-0 text-muted transition-colors group-hover:text-accent"
							aria-hidden="true"
						/>
						<span class="min-w-0 flex-1">
							<span
								class="block truncate text-sm leading-snug font-medium text-text group-hover:text-accent"
							>
								{link.title}
							</span>
							{#if context(link.slug)}
								<span class="block truncate text-xs text-muted">{context(link.slug)}</span>
							{/if}
						</span>
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}
