<script lang="ts">
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { prefersReducedMotion } from 'svelte/motion';
	import { X } from '@lucide/svelte';
	import { fileRoute } from '$lib/files';
	import { sameFile, tabLabel, type FileTab } from '$lib/file-tabs';
	import { fileWorkspace } from './file-workspace.svelte';
	import FileIcon from './FileIcon.svelte';
	const { course, path, isFile }: { course: string; path: string; isFile: boolean } = $props();
	const workspace = fileWorkspace();
	const tabs = $derived(
		workspace.ready
			? workspace.tabs
			: isFile
				? [{ course, path, pinned: false, top: 0, left: 0 }]
				: []
	);
	let strip = $state<HTMLElement>();
	let dragging = $state<FileTab>();
	let preview = $state({ left: 0, top: 0, width: 0, height: 0 });
	let gesture: { tab: FileTab; x: number; left: number; centers: number[] } | undefined;
	let suppressClick = false;

	function startDrag(event: PointerEvent, tab: FileTab) {
		if (
			event.button !== 0 ||
			event.ctrlKey ||
			event.metaKey ||
			event.altKey ||
			event.shiftKey ||
			!strip
		)
			return;
		suppressClick = false;
		const bounds = (event.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
		preview = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
		gesture = {
			tab,
			x: event.clientX,
			left: bounds.left,
			centers: Array.from(strip.children, (child) => {
				const element = child as HTMLElement;
				return element.offsetLeft + element.offsetWidth / 2;
			})
		};
	}

	function drag(event: PointerEvent) {
		if (!gesture || !strip) return;
		if (event.buttons === 0) return endDrag();
		if (!dragging && Math.abs(event.clientX - gesture.x) < 6) return;
		if (!dragging) {
			dragging = gesture.tab;
			strip.setPointerCapture(event.pointerId);
		}
		preview.left = gesture.left + event.clientX - gesture.x;
		const bounds = strip.getBoundingClientRect();
		if (event.clientX < bounds.left + 32) strip.scrollLeft -= 16;
		else if (event.clientX > bounds.right - 32) strip.scrollLeft += 16;
		const x = event.clientX - bounds.left + strip.scrollLeft;
		const destination = gesture.centers.reduce(
			(nearest, center, index, centers) =>
				Math.abs(center - x) < Math.abs(centers[nearest] - x) ? index : nearest,
			0
		);
		workspace.move(gesture.tab, destination);
	}

	function endDrag() {
		if (!gesture) return;
		suppressClick = !!dragging;
		dragging = undefined;
		gesture = undefined;
	}

	function activate(event: MouseEvent, tab: FileTab) {
		if (suppressClick) {
			event.preventDefault();
			suppressClick = false;
			return;
		}
		workspace.activate(event, tab.course, tab.path);
	}

	async function reorderWithKeyboard(event: KeyboardEvent, tab: FileTab) {
		if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
		event.preventDefault();
		const link = event.currentTarget as HTMLElement;
		workspace.move(
			tab,
			tabs.findIndex((item) => sameFile(item, tab)) + (event.key === 'ArrowLeft' ? -1 : 1)
		);
		await tick();
		link.focus({ preventScroll: true });
	}
	$effect(() => {
		course;
		path;
		tabs.length;
		void tick().then(() => {
			const active = strip?.querySelector<HTMLElement>('[aria-current="page"]');
			if (!active || !strip) return;
			const bounds = strip.getBoundingClientRect();
			const item = active.getBoundingClientRect();
			if (item.left < bounds.left) strip.scrollLeft += item.left - bounds.left;
			else if (item.right > bounds.right) strip.scrollLeft += item.right - bounds.right;
		});
	});
	async function close(tab: FileTab) {
		const next = workspace.close(tab);
		if (sameFile(tab, { course, path })) await goto(fileRoute(next?.course ?? course, next?.path));
	}
</script>

<nav
	class="relative flex min-w-0 flex-1 overflow-x-auto select-none [scrollbar-width:thin]"
	aria-label="Open files"
	bind:this={strip}
	onpointermove={drag}
	onpointerup={endDrag}
	onpointercancel={endDrag}
	onlostpointercapture={(event) => {
		if (event.target === strip) endDrag();
	}}
	onpointerleave={() => {
		if (!dragging) endDrag();
	}}
>
	{#each tabs as tab (`${tab.course}/${tab.path}`)}
		<div
			animate:flip={{
				duration: prefersReducedMotion.current || (dragging && sameFile(dragging, tab)) ? 0 : 160
			}}
			class="group flex shrink-0 items-center border-r border-border"
			class:bg-bg={isFile && sameFile(tab, { course, path })}
			class:opacity-0={dragging && sameFile(dragging, tab)}
		>
			<a
				class="flex min-w-0 touch-pan-y items-center gap-2 py-2 pl-3 pr-1 font-mono text-xs text-muted no-underline aria-[current=page]:text-text"
				class:italic={!tab.pinned}
				href={fileRoute(tab.course, tab.path)}
				aria-current={isFile && sameFile(tab, { course, path }) ? 'page' : undefined}
				title={`${tab.course}/${tab.path}${!tab.pinned ? ' — double-click to keep open' : ''}`}
				draggable="false"
				ondragstart={(event) => event.preventDefault()}
				aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
				onpointerdown={(event) => startDrag(event, tab)}
				onclick={(event) => activate(event, tab)}
				onkeydown={(event) => reorderWithKeyboard(event, tab)}
			>
				<FileIcon name={tab.path.split('/').at(-1)!} /><span class="max-w-64 truncate"
					>{tabLabel(tab, tabs)}</span
				>
			</a>
			<button
				class="m-0.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface hover:text-text"
				aria-label={`Close ${tabLabel(tab, tabs)}`}
				disabled={!workspace.ready}
				onclick={() => close(tab)}><X size={12} /></button
			>
		</div>
	{/each}
</nav>

{#if dragging}
	<div
		aria-hidden="true"
		data-drag-preview
		class="pointer-events-none fixed z-50 flex items-center gap-2 border border-border bg-bg px-3 font-mono text-xs text-text shadow-md"
		style:left={`${preview.left}px`}
		style:top={`${preview.top}px`}
		style:width={`${preview.width}px`}
		style:height={`${preview.height}px`}
	>
		<FileIcon name={dragging.path.split('/').at(-1)!} />
		<span class="truncate">{tabLabel(dragging, tabs)}</span>
	</div>
{/if}
