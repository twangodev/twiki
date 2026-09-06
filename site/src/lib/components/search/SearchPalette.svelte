<script lang="ts">
	import { Command, Dialog } from 'bits-ui';
	import { goto } from '$app/navigation';
	import { Search } from '@lucide/svelte';
	import {
		ensureIndex,
		resetIndex,
		searchClient,
		searchPagefind,
		type SearchGroup
	} from './pagefind-client.svelte';
	import { parseSearchQuery } from './pagefind-query';
	import { closeSearch, searchState, toggleSearch } from './search-state.svelte';

	let query = $state('');
	let course = $state('');
	let tag = $state('');
	let groups = $state<SearchGroup[]>([]);

	const courseOptions = $derived(Object.entries(searchClient.filters.course ?? {}).sort());
	const tagOptions = $derived(Object.entries(searchClient.filters.tag ?? {}).sort());
	const parsedQuery = $derived(parseSearchQuery(query));

	const activeFilters = $derived.by(() => {
		const f: Record<string, string[]> = {};
		if (course) f.course = [course];
		if (parsedQuery.tag) f.tag = [parsedQuery.tag];
		else if (tag) f.tag = [tag];
		return f;
	});

	$effect(() => {
		const parsed = parsedQuery;
		const filters = activeFilters;
		if (searchClient.status !== 'ready' || (parsed.term !== null && parsed.term.length < 2)) {
			groups = [];
			return;
		}
		void searchPagefind(parsed.term, filters).then((out) => {
			// null = superseded by a newer keystroke; keep current results.
			if (out !== null) groups = out;
		});
	});

	async function navigate(url: string) {
		closeSearch();
		// Heading ids are baked into the prerendered HTML, so a plain goto
		// lands on the section anchor directly.
		await goto(url);
	}

	function isEditable(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		return (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			target.isContentEditable
		);
	}

	function onKeydown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			toggleSearch();
			return;
		}
		if (
			event.key === '/' &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			!searchState.open &&
			!isEditable(event.target)
		) {
			event.preventDefault();
			toggleSearch();
		}
	}

	function retry() {
		resetIndex();
		void ensureIndex();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<Dialog.Root bind:open={searchState.open}>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/40" />
		<Dialog.Content
			class="fixed top-[15vh] left-1/2 z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-bg shadow-2xl"
		>
			<Dialog.Title class="sr-only">Search</Dialog.Title>
			<Command.Root shouldFilter={false} label="Search site">
				<div class="flex items-center gap-2 border-b border-border px-3">
					<Search class="size-4 shrink-0 text-text/60" />
					<Command.Input
						bind:value={query}
						placeholder="Search… or #tag"
						class="h-11 w-full bg-transparent text-sm text-text outline-none placeholder:text-text/50"
					/>
				</div>
				{#if searchClient.status === 'ready' && (courseOptions.length > 0 || tagOptions.length > 0)}
					<div class="flex items-center gap-2 border-b border-border px-3 py-2">
						{#if courseOptions.length > 0}
							<select
								bind:value={course}
								aria-label="Filter by course"
								class="max-w-[50%] cursor-pointer rounded-md border border-border bg-bg px-2 py-1 text-xs text-text/80 outline-none focus-visible:ring-2 focus-visible:ring-accent"
							>
								<option value="">All courses</option>
								{#each courseOptions as [value, count] (value)}
									<option {value}>{value} ({count})</option>
								{/each}
							</select>
						{/if}
						{#if tagOptions.length > 0}
							<select
								bind:value={tag}
								aria-label="Filter by tag"
								class="max-w-[50%] cursor-pointer rounded-md border border-border bg-bg px-2 py-1 text-xs text-text/80 outline-none focus-visible:ring-2 focus-visible:ring-accent"
							>
								<option value="">All tags</option>
								{#each tagOptions as [value, count] (value)}
									<option {value}>{value} ({count})</option>
								{/each}
							</select>
						{/if}
					</div>
				{/if}
				<Command.List class="max-h-[60vh] overflow-y-auto p-2">
					{#if searchClient.status === 'loading' || searchClient.status === 'idle'}
						<div class="block px-3 py-6 text-center text-sm text-text/60">Loading index…</div>
					{:else if searchClient.status === 'missing'}
						<div
							class="flex flex-col items-center gap-2 px-3 py-6 text-center text-sm text-text/60"
						>
							{#if import.meta.env.DEV}
								<span>No search index in dev — Pagefind indexes the built site.</span>
								<code class="rounded-sm bg-surface px-1.5 py-0.5 text-xs"
									>bun run build</code
								>
							{:else}
								<span>Couldn't load the search index.</span>
								<button
									type="button"
									class="cursor-pointer rounded-md border border-border px-2.5 py-1 text-text transition-colors hover:bg-surface"
									onclick={retry}
								>
									Retry
								</button>
							{/if}
						</div>
					{:else}
						<Command.Empty class="block px-3 py-6 text-center text-sm text-text/60">
							{parsedQuery.term !== null && parsedQuery.term.length < 2
								? 'Type at least 2 characters…'
								: 'No results'}
						</Command.Empty>
						{#each groups as group (group.id)}
							<Command.Group value={group.id}>
								<Command.GroupHeading class="px-3 pt-3 pb-1 text-xs font-semibold text-text/60">
									{group.title}
								</Command.GroupHeading>
								<Command.GroupItems>
									{#each group.sections as section, i (`${group.id}:${i}`)}
										<Command.Item
											value={`${group.id}:${i}`}
											onSelect={() => navigate(section.url)}
											class="flex cursor-pointer flex-col gap-0.5 rounded-md px-3 py-2 data-selected:bg-surface"
										>
											<span class="text-sm text-text">{section.title}</span>
											<span
												class="truncate text-xs text-text/60 [&_mark]:rounded-sm [&_mark]:bg-accent/20 [&_mark]:text-text"
											>
												<!-- eslint-disable-next-line svelte/no-at-html-tags -- Pagefind excerpt over our own prerendered corpus -->
												{@html section.excerpt}
											</span>
										</Command.Item>
									{/each}
								</Command.GroupItems>
							</Command.Group>
						{/each}
					{/if}
				</Command.List>
			</Command.Root>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
