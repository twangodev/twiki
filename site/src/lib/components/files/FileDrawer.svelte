<script lang="ts">
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import { ChevronRight, FolderCode } from '@lucide/svelte';
	import { slide } from 'svelte/transition';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fileIndexUrl, fileRoute, fileTree, type CourseFile } from '$lib/files';
	import FileTree from './FileTree.svelte';

	const { course }: { course: string } = $props();
	const uid = $props.id();
	let opened = $state(page.data.kind === 'file-browser');
	let viewport = $state<HTMLDivElement>();
	let files = $state<CourseFile[]>();
	let failed = $state(false);
	let attempt = $state(0);
	const browsing = $derived(page.data.kind === 'file-browser');
	const current = $derived(browsing ? (page.params.file ?? '') : '');
	const focus = $derived(
		browsing
			? current
			: (files?.find((file) => file.note === decodeURI(page.url.pathname))?.path ?? '')
	);
	const tree = $derived(fileTree(files ?? []));

	$effect(() => {
		if (browsing) opened = true;
	});
	$effect(() => {
		current;
		files;
		if (!opened || !viewport) return;
		let cancelled = false;
		void tick().then(() => {
			if (cancelled || !viewport) return;
			const active = viewport.querySelector<HTMLElement>('[aria-current="page"]');
			if (active)
				viewport.scrollTop +=
					active.getBoundingClientRect().top -
					viewport.getBoundingClientRect().top -
					viewport.clientHeight / 2;
		});
		return () => {
			cancelled = true;
		};
	});
	$effect(() => {
		if (!opened) return;
		attempt;
		const controller = new AbortController();
		failed = false;
		fetch(fileIndexUrl(course), { signal: controller.signal })
			.then(async (response) => {
				if (!response.ok) throw new Error('Files unavailable');
				const result: CourseFile[] = await response.json();
				if (!controller.signal.aborted) files = result;
			})
			.catch(() => {
				if (!controller.signal.aborted) failed = true;
			});
		return () => controller.abort();
	});
</script>

<section
	class="flex max-h-[45%] min-h-0 shrink-0 flex-col border-t border-border pt-2"
	aria-label="Course files"
	data-pagefind-ignore
>
	<button
		class="flex w-full shrink-0 cursor-pointer items-center gap-2 rounded px-2 py-2 text-xs font-medium text-muted hover:bg-surface hover:text-text"
		aria-expanded={opened}
		aria-controls={uid}
		onclick={() => (opened = !opened)}
	>
		<ChevronRight size={13} class={opened ? 'rotate-90' : ''} />
		<FolderCode size={15} />
		<span>Files</span>
	</button>
	<div
		id={uid}
		bind:this={viewport}
		class="min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:thin]"
	>
		{#if opened}
			<div transition:slide={{ duration: prefersReducedMotion.current ? 0 : 160 }}>
				{#if failed}
					<p class="px-2 py-2 text-xs text-muted">
						Couldn’t load files. <button
							class="cursor-pointer text-accent"
							onclick={() => attempt++}>Retry</button
						>
					</p>
				{:else if files}
					<a
						class="mb-1 block px-2 py-1 text-xs text-muted hover:text-accent"
						href={fileRoute(course)}
						>Browse directory <span class="float-right">{files.length} files</span></a
					>
					<FileTree nodes={tree} {course} {current} {focus} />
				{:else}<p class="px-2 py-2 text-xs text-muted" role="status">Loading files…</p>{/if}
			</div>
		{/if}
	</div>
</section>
