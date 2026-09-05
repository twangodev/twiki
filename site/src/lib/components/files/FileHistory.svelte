<script lang="ts">
	import { onDestroy } from 'svelte';
	import { fly } from 'svelte/transition';
	import { prefersReducedMotion } from 'svelte/motion';
	import { X } from '@lucide/svelte';
	import type { FileHistory, FileBlame, FileChange } from '$lib/file-history';
	let {
		url,
		open = $bindable(false),
		blaming = $bindable(false),
		selected = $bindable(''),
		onblame,
		onview
	}: {
		url: string;
		open?: boolean;
		blaming?: boolean;
		selected?: string;
		onblame: (blame: FileBlame | undefined) => void;
		onview: (text: string, commit: FileChange) => void;
	} = $props();
	let history = $state<FileHistory>();
	let blame = $state<FileBlame>();
	let error = $state('');
	let loadingDiff = $state('');
	let pending: Promise<void> | undefined;
	const controller = new AbortController();
	let selection = 0;
	onDestroy(() => controller.abort());
	async function load() {
		if (pending) return pending;
		pending = (async () => {
			try {
				const response = await fetch(url, { signal: controller.signal });
				if (!response.ok) throw new Error('History unavailable');
				history = await response.json();
			} catch {
				if (!controller.signal.aborted) error = 'Could not load history.';
			}
		})();
		return pending;
	}
	$effect(() => {
		if (open || blaming) void load();
	});
	$effect(() => {
		if (!blaming || !history?.blame) {
			onblame(undefined);
			return;
		}
		if (blame) {
			onblame(blame);
			return;
		}
		const request = new AbortController();
		void fetch(history.blame, { signal: request.signal })
			.then(async (response) => {
				if (!response.ok) throw new Error('Blame unavailable');
				const result: FileBlame = await response.json();
				if (!request.signal.aborted) blame = result;
			})
			.catch(() => {
				if (!request.signal.aborted) {
					error = 'Could not load blame.';
					open = true;
				}
			});
		return () => request.abort();
	});
	$effect(() => {
		if (blaming && history && !history.blame) {
			blaming = false;
			open = true;
		}
	});
	async function view(commit: FileChange) {
		selected = commit.id;
		const request = ++selection;
		loadingDiff = '';
		if (!commit.diff) return;
		loadingDiff = commit.id;
		error = '';
		try {
			const response = await fetch(commit.diff, { signal: controller.signal });
			if (!response.ok) throw new Error('Diff unavailable');
			const text = await response.text();
			if (request === selection && selected === commit.id && !controller.signal.aborted)
				onview(text, commit);
		} catch {
			if (!controller.signal.aborted && request === selection)
				error = 'Could not load this change.';
		} finally {
			if (request === selection) loadingDiff = '';
		}
	}
</script>

{#if open}
	<aside
		aria-label="File history"
		class="absolute inset-y-0 right-0 z-20 flex w-80 max-w-full shrink-0 flex-col border-l border-border bg-bg md:static"
		transition:fly={{ x: 8, duration: prefersReducedMotion.current ? 0 : 140 }}
	>
		<header class="flex items-center justify-between border-b border-border px-3 py-2 text-xs">
			<span>History</span><button
				class="text-muted hover:text-text"
				aria-label="Close history"
				onclick={() => (open = false)}><X size={14} /></button
			>
		</header>
		{#if error}<div class="p-3 text-xs text-muted" role="alert">
				{error}
				<button
					class="text-accent"
					onclick={() => {
						pending = undefined;
						error = '';
						void load();
					}}>Retry</button
				>
			</div>{/if}
		<div class="min-h-0 flex-1 overflow-y-auto">
			{#if history}
				{#if selected && blame?.commits[selected] && !history.commits.some((commit) => commit.id === selected)}
					<div class="border-b border-border p-3 text-xs">
						<p>{blame.commits[selected].subject}</p>
						<p class="mt-1 text-muted">
							{selected.slice(0, 7)} · This commit is from a merged branch. The list below follows first-parent
							history.
						</p>
					</div>
				{/if}
				{#if history.notice}<p class="border-b border-border p-3 text-xs text-muted">
						{history.notice}
					</p>{/if}
				<ol class="m-0 list-none divide-y divide-border p-0">
					{#each history.commits as commit (commit.id)}
						<li>
							<button
								class="w-full px-3 py-2.5 text-left hover:bg-surface"
								class:bg-surface={selected === commit.id}
								aria-pressed={selected === commit.id}
								onclick={() => view(commit)}
							>
								<span class="block break-words text-xs text-text">{commit.subject}</span>
								<span class="mt-1 block text-[0.6875rem] text-muted"
									>{commit.author} · {commit.date.slice(0, 10)} ·
									<span class="font-mono">{commit.id.slice(0, 7)}</span></span
								>
								{#if commit.previousPath}<span
										class="mt-1 block break-all text-[0.6875rem] text-muted"
										>Renamed from {commit.previousPath}</span
									>{/if}
								{#if selected === commit.id && commit.unavailable}<span
										class="mt-1 block text-xs text-muted">{commit.unavailable}</span
									>{/if}
								{#if loadingDiff === commit.id}<span class="block text-xs text-muted" role="status"
										>Loading changes…</span
									>{/if}
							</button>
						</li>
					{:else}<li class="p-3 text-xs text-muted">No committed history.</li>{/each}
				</ol>
			{:else if !error}<p class="p-3 text-xs text-muted" role="status">Loading history…</p>{/if}
		</div>
		{#if history}<footer class="border-t border-border px-3 py-2 text-[0.6875rem] text-muted">
				First-parent history · {history.revision.slice(0, 7)}
			</footer>{/if}
	</aside>
{/if}
