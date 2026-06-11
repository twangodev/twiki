<script lang="ts">
	import { page } from '$app/state';
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import type { NavNode } from '$lib/types';
	import { cn } from '$lib/utils';

	interface Props {
		nav: NavNode[];
	}

	interface PagerItem {
		title: string;
		route: string;
	}

	const { nav }: Props = $props();

	const pages = $derived(flattenNav(nav));
	const currentRoute = $derived(normalizeRoute(page.url.pathname));
	const currentIndex = $derived(pages.findIndex((item) => item.route === currentRoute));
	const previousPage = $derived(currentIndex > 0 ? pages[currentIndex - 1] : undefined);
	const nextPage = $derived(
		currentIndex >= 0 && currentIndex < pages.length - 1 ? pages[currentIndex + 1] : undefined
	);

	function flattenNav(nodes: NavNode[]): PagerItem[] {
		const items: PagerItem[] = [];
		const seenRoutes = new Set<string>();

		function visit(node: NavNode): void {
			if (node.route) {
				const route = normalizeRoute(node.route);
				if (!seenRoutes.has(route)) {
					seenRoutes.add(route);
					items.push({ title: node.title, route });
				}
			}

			for (const child of node.children) visit(child);
		}

		for (const node of nodes) visit(node);
		return items;
	}

	/** trailingSlash is 'never' on this site: compare routes without it. */
	function normalizeRoute(path: string): string {
		let normalized = path.startsWith('/') ? path : `/${path}`;
		if (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
		return normalized;
	}

	const linkClass =
		'group flex min-h-16 items-center gap-3 rounded-md border border-border px-4 py-3 no-underline transition-colors hover:border-accent hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none';
	const labelClass = 'block text-xs font-semibold uppercase text-muted';
	const titleClass = 'block text-sm font-semibold leading-snug text-text group-hover:text-accent';
</script>

{#if previousPage || nextPage}
	<nav
		class="mt-12 grid grid-cols-2 gap-3 border-t border-border pt-6 max-[640px]:grid-cols-1"
		aria-label="Page navigation"
	>
		{#if previousPage}
			<a class={linkClass} href={previousPage.route}>
				<ChevronLeft class="size-5 shrink-0 text-muted transition-colors group-hover:text-accent" />
				<span class="min-w-0">
					<span class={labelClass}>Previous</span>
					<span class={titleClass}>{previousPage.title}</span>
				</span>
			</a>
		{:else}
			<div class="max-[640px]:hidden" aria-hidden="true"></div>
		{/if}

		{#if nextPage}
			<a class={cn(linkClass, 'justify-end text-right')} href={nextPage.route}>
				<span class="min-w-0">
					<span class={labelClass}>Next</span>
					<span class={titleClass}>{nextPage.title}</span>
				</span>
				<ChevronRight
					class="size-5 shrink-0 text-muted transition-colors group-hover:text-accent"
				/>
			</a>
		{:else}
			<div class="max-[640px]:hidden" aria-hidden="true"></div>
		{/if}
	</nav>
{/if}
