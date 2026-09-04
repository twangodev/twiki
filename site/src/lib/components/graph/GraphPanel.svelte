<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import { Spring, prefersReducedMotion } from 'svelte/motion';
	import { Maximize2, X } from '@lucide/svelte';
	import {
		addToVisited,
		idForRoute,
		loadGraph,
		localGraphConfig,
		globalGraphConfig,
		type GraphData
	} from './graph-data';
	import GraphView from './GraphView.svelte';
	import IconButton from '../ui/IconButton.svelte';

	let data = $state<GraphData | null>(null);
	let failed = $state(false);
	let renderReady = $state(false);
	let expanded = $state(false);
	let closing = $state(false);
	let wide = $state(false);
	let mode = $state<'local' | 'global'>('local');
	let dialog: HTMLDialogElement;
	let slot: HTMLDivElement;
	let opener: HTMLElement | null = null;
	const bounds = new Spring(
		{ x: 0, y: 0, width: 0, height: 250 },
		{ stiffness: 0.16, damping: 0.85, precision: 0.5 }
	);
	const currentId = $derived(data ? idForRoute(page.url.pathname, data) : undefined);
	function homeBounds() {
		const rect = slot.getBoundingClientRect();
		return wide
			? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
			: { x: innerWidth / 2, y: innerHeight / 2, width: 1, height: 1 };
	}
	async function openGraph() {
		if (!data || expanded) return;
		opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		await bounds.set(homeBounds(), { instant: true });
		expanded = true;
		if (!wide) mode = 'global';
		await tick();
		dialog.showModal();
		void bounds.set(
			{ x: 0, y: 0, width: innerWidth, height: innerHeight },
			{ instant: prefersReducedMotion.current }
		);
	}
	async function closeGraph() {
		if (!expanded || closing) return;
		closing = true;
		await bounds.set(homeBounds(), { instant: prefersReducedMotion.current }).catch(() => {});
		dialog.close();
		expanded = false;
		closing = false;
		mode = 'local';
		await tick();
		opener?.focus({ preventScroll: true });
	}
	onMount(() => {
		const media = window.matchMedia('(width >= 1440px)');
		const updateWidth = () => (wide = media.matches);
		const resize = () => {
			if (expanded)
				void bounds.set(
					closing ? homeBounds() : { x: 0, y: 0, width: innerWidth, height: innerHeight },
					{ instant: true }
				);
		};
		updateWidth();
		media.addEventListener('change', updateWidth);
		window.addEventListener('resize', resize);
		let cancelled = false;
		void Promise.all([loadGraph(), import('./render-graph')]).then(
			([graph]) => {
				if (!cancelled) data = graph;
			},
			() => {
				if (!cancelled) failed = true;
			}
		);
		return () => {
			cancelled = true;
			media.removeEventListener('change', updateWidth);
			window.removeEventListener('resize', resize);
		};
	});
	$effect(() => {
		if (currentId) addToVisited(currentId);
	});
	$effect(() => {
		if (!expanded) return;
		const previous = document.documentElement.style.overflow;
		document.documentElement.style.overflow = 'hidden';
		return () => {
			document.documentElement.style.overflow = previous;
		};
	});
	function onKeydown(event: KeyboardEvent) {
		if (data && event.key === 'g' && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
			event.preventDefault();
			void (expanded ? closeGraph() : openGraph());
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<button
	type="button"
	class="doc-compact-graph cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface disabled:opacity-50"
	disabled={!data}
	onclick={openGraph}>Open global graph</button
>
<section class="graph-panel min-w-0 shrink-0" class:expanded aria-label="Graph view">
	<div class="relative h-[250px]" data-graph-outer bind:this={slot}>
		<dialog
			bind:this={dialog}
			class:expanded
			class:closing
			role={expanded ? 'dialog' : 'group'}
			aria-label="Graph canvas"
			oncancel={(event) => {
				event.preventDefault();
				void closeGraph();
			}}
			style={expanded
				? `left:${bounds.current.x}px;top:${bounds.current.y}px;width:${bounds.current.width}px;height:${bounds.current.height}px`
				: undefined}
		>
			{#if failed}
				<p class="status">Graph unavailable.</p>
			{:else if data && (currentId || mode === 'global') && (wide || expanded)}
				<GraphView
					{data}
					{currentId}
					config={mode === 'local' ? localGraphConfig : globalGraphConfig}
					global={expanded}
					onready={() => (renderReady = true)}
					onerror={() => (failed = true)}
					onnavigate={() => {
						dialog.close();
						expanded = false;
						closing = false;
						mode = 'local';
					}}
				/>
				{#if !renderReady}<div
						class="status pointer-events-none absolute inset-0"
						aria-hidden="true"
					>
						<span class="size-5 animate-pulse rounded-full bg-subtle"></span>
					</div>{/if}
			{:else}<p class="status">{data ? 'This page is not in the graph.' : 'Loading graph…'}</p>{/if}
			<h3
				class="pointer-events-none absolute top-1 left-1 m-0 rounded bg-bg/80 px-1.5 py-1 text-xs font-medium text-muted"
			>
				Graph View
			</h3>
			{#if expanded}
				<div class="graph-modes" aria-label="Graph scope">
					<button
						aria-pressed={mode === 'local'}
						disabled={!currentId || closing}
						onclick={() => (mode = 'local')}>Local</button
					>
					<button
						aria-pressed={mode === 'global'}
						disabled={closing}
						onclick={() => (mode = 'global')}>Global</button
					>
				</div>
			{/if}
			<IconButton
				class="graph-expand absolute top-1 right-1 size-6 rounded"
				aria-label={expanded ? 'Close' : 'Expand graph'}
				title={expanded ? 'Close graph (Escape)' : 'Expand graph'}
				disabled={!data || closing}
				onclick={() => (expanded ? closeGraph() : openGraph())}
			>
				{#if expanded}<X size={16} />{:else}<Maximize2 size={14} />{/if}
			</IconButton>
		</dialog>
	</div>
</section>

<style>
	dialog {
		display: block;
		position: relative;
		inset: auto;
		margin: 0;
		padding: 0;
		width: 100%;
		height: 250px;
		max-width: none;
		max-height: none;
		border: 0;
		overflow: hidden;
		color: var(--color-text);
		background: var(--color-bg);
	}
	dialog.expanded {
		position: fixed;
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.35);
		animation: backdrop-in 180ms ease-out;
	}
	dialog.closing::backdrop {
		opacity: 0;
		transition: opacity 180ms;
	}
	.status {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		font-size: 0.75rem;
		color: var(--color-muted);
	}
	.graph-modes {
		position: absolute;
		top: 0.5rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		padding: 0.125rem;
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		background: var(--color-bg);
	}
	.graph-modes button {
		padding: 0.25rem 0.75rem;
		border-radius: 0.25rem;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.graph-modes button[aria-pressed='true'] {
		background: var(--color-surface);
		color: var(--color-accent);
	}
	.graph-modes button:focus-visible {
		outline: 2px solid var(--color-accent);
	}
	@keyframes backdrop-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@media (width < 1440px) {
		.graph-panel.expanded {
			display: block;
			height: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		dialog::backdrop {
			animation: none;
			transition: none;
		}
	}
</style>
