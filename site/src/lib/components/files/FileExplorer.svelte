<script lang="ts">
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import { fileIndexUrl, fileRoute, fileTree, type CourseFile } from '$lib/files';
	import FileTree from './FileTree.svelte';

	const { course }: { course: string } = $props();
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
		current;
		files;
		if (!viewport) return;
		let cancelled = false;
		void tick().then(() => {
			if (cancelled || !viewport) return;
			const active = viewport.querySelector<HTMLElement>('[aria-current="page"]');
			if (!active) return;
			const bounds = viewport.getBoundingClientRect();
			const row = active.getBoundingClientRect();
			if (row.top < bounds.top) viewport.scrollTop += row.top - bounds.top;
			else if (row.bottom > bounds.bottom) viewport.scrollTop += row.bottom - bounds.bottom;
		});
		return () => {
			cancelled = true;
		};
	});
	$effect(() => {
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

<section class="flex h-full min-h-0 flex-col" aria-label="Course files" data-pagefind-ignore>
	<div
		bind:this={viewport}
		class="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]"
	>
		{#if failed}
			<p class="px-2 py-2 text-xs text-muted">
				Couldn’t load files. <button class="cursor-pointer text-accent" onclick={() => attempt++}
					>Retry</button
				>
			</p>
		{:else if files}
			<a class="mb-1 block px-2 py-1 text-xs text-muted hover:text-accent" href={fileRoute(course)}
				>Browse directory <span class="float-right">{files.length} files</span></a
			>
			<FileTree nodes={tree} {course} {current} {focus} />
		{:else}<p class="px-2 py-2 text-xs text-muted" role="status">Loading files…</p>{/if}
	</div>
</section>
