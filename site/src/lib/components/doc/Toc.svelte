<script lang="ts">
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { Spring, prefersReducedMotion } from 'svelte/motion';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { TocEntry } from '$lib/types';

	const uid = $props.id();
	const { active }: { active: string } = $props();
	const items = $derived((page.data.toc as TocEntry[] | undefined) ?? []);
	type Node = TocEntry & { children: Node[]; ancestors: string[] };
	const tree = $derived.by(() => {
		const roots: Node[] = [],
			parents: Node[] = [];
		for (const item of items) {
			while (parents.length && parents[parents.length - 1].level >= item.level) parents.pop();
			const node: Node = { ...item, children: [], ancestors: parents.map((p) => p.id) };
			(parents.at(-1)?.children ?? roots).push(node);
			parents.push(node);
		}
		return roots;
	});
	const nodes = $derived.by(() => {
		const result = new Map<string, Node>();
		function visit(branch: Node[]) {
			for (const node of branch) {
				result.set(node.id, node);
				visit(node.children);
			}
		}
		visit(tree);
		return result;
	});
	let focused = $state('');
	let overrides = $state<Record<string, boolean>>({});
	let expandAll = $state(false);
	let list = $state<HTMLDivElement>();
	let markerVisible = $state(false);
	const marker = new Spring({ y: 0, height: 0 }, { stiffness: 0.2, damping: 0.85 });
	const documentRoot = $derived(tree.length === 1 && tree[0].level === 1 ? tree[0].id : '');
	function isOpen(node: Node): boolean {
		if (nodes.get(focused)?.ancestors.includes(node.id)) return true;
		return (
			expandAll ||
			(overrides[node.id] ??
				Boolean(
					node.id === documentRoot ||
					nodes.get(active)?.ancestors.includes(node.id) ||
					active === node.id
				))
		);
	}
	function measureMarker() {
		const link = Array.from(
			list?.querySelectorAll<HTMLAnchorElement>('a[aria-current="location"]') ?? []
		).find((link) => link.getAttribute('href') === `#${encodeURIComponent(active)}`);
		markerVisible = Boolean(link && link.getClientRects().length);
		if (!link || !markerVisible || !list) return;
		const box = link.getBoundingClientRect();
		void marker.set(
			{ y: box.top - list.getBoundingClientRect().top, height: box.height },
			{ instant: prefersReducedMotion.current }
		);
	}
	function followActive() {
		const viewport = list?.closest<HTMLElement>('.doc-toc');
		const link = Array.from(
			list?.querySelectorAll<HTMLAnchorElement>('a[aria-current="location"]') ?? []
		).find((link) => link.getAttribute('href') === `#${encodeURIComponent(active)}`);
		if (!link?.getClientRects().length) return;
		if (viewport && viewport.clientHeight < viewport.scrollHeight) {
			const box = link.getBoundingClientRect();
			const bounds = viewport.getBoundingClientRect();
			const headerHeight =
				viewport.querySelector('.toc-header')?.getBoundingClientRect().height ?? 0;
			const top = bounds.top + headerHeight + 24;
			const bottom = bounds.bottom - 12;
			// Leave room for nearby headings instead of riding the viewport edge.
			const cushion = Math.min(48, Math.max(0, (bottom - top - box.height) / 4));
			const delta =
				box.top < top
					? box.top - top - cushion
					: box.bottom > bottom
						? box.bottom - bottom + cushion
						: 0;
			if (Math.abs(delta) > 1)
				viewport.scrollTo({
					top: viewport.scrollTop + delta,
					behavior: prefersReducedMotion.current ? 'instant' : 'smooth'
				});
		}
	}
	$effect(() => {
		items;
		untrack(() => {
			overrides = {};
			expandAll = false;
			focused = '';
		});
	});
	$effect(() => {
		active;
		expandAll;
		overrides;
		focused;
		if (!list) return;
		let followTimer: ReturnType<typeof setTimeout>;
		function measure() {
			measureMarker();
			// Branch slides resize on every frame. Follow once they settle, rather
			// than repeatedly restarting a scroll against a moving target.
			clearTimeout(followTimer);
			followTimer = setTimeout(followActive, prefersReducedMotion.current ? 0 : 80);
		}
		const frame = requestAnimationFrame(measure);
		const observer = new ResizeObserver(measure);
		observer.observe(list);
		const viewport = list.closest('.doc-toc');
		if (viewport) observer.observe(viewport);
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(followTimer);
			observer.disconnect();
		};
	});
</script>

{#snippet branches(branch: Node[], depth = 0)}
	<ul class="toc-branches" class:nested={depth > 0 && depth <= 2}>
		{#each branch as item (item.id)}
			<li>
				{#if depth > 2 && branch[0] === item}
					<div class="parent-context">↳ {nodes.get(item.ancestors.at(-1) ?? '')?.text}</div>
				{/if}
				<div class="toc-row">
					{#if item.children.length}
						<button
							class="branch-toggle"
							aria-label={`Toggle ${item.text} sections`}
							aria-expanded={isOpen(item)}
							aria-controls={`${uid}-${item.id}`}
							onfocus={() => (focused = item.id)}
							onblur={() => (focused = '')}
							onclick={() => {
								overrides = { ...overrides, [item.id]: !isOpen(item) };
								expandAll = false;
							}}
						>
							<svg
								class:open={isOpen(item)}
								width="12"
								height="12"
								viewBox="0 0 16 16"
								aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg
							>
						</button>
					{:else}<span class="leaf-spacer"></span>{/if}
					<a
						class:parent={item.children.length > 0}
						href={`#${encodeURIComponent(item.id)}`}
						aria-current={active === item.id ? 'location' : undefined}
						onfocus={() => (focused = item.id)}
						onblur={() => (focused = '')}>{item.text}</a
					>
				</div>
				<div id={`${uid}-${item.id}`}>
					{#if item.children.length && isOpen(item)}
						<div
							onoutrostart={(event) => {
								// Outgoing Svelte blocks retain their old attributes until the slide ends.
								// Remove their stale current marker and keyboard/accessibility targets now.
								event.currentTarget.inert = true;
								event.currentTarget
									.querySelectorAll('[aria-current]')
									.forEach((link) => link.removeAttribute('aria-current'));
							}}
							onintrostart={(event) => {
								event.currentTarget.inert = false;
							}}
							transition:slide={{
								duration: prefersReducedMotion.current ? 0 : 180,
								easing: cubicOut
							}}
						>
							{@render branches(item.children, depth + (item.id === documentRoot ? 0 : 1))}
						</div>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
{/snippet}

{#if items.length > 0}
	<nav aria-label="On this page">
		<div class="toc-header">
			<p>On this page</p>
			{#if items.some((item) => nodes.get(item.id)?.children.length)}
				<button
					class="mode-toggle"
					onclick={() => {
						expandAll = !expandAll;
						overrides = {};
					}}>{expandAll ? 'Focus' : 'Expand all'}</button
				>
			{/if}
		</div>
		<div class="toc-list" bind:this={list}>
			<span
				class="position-marker"
				aria-hidden="true"
				style:opacity={markerVisible ? 1 : 0}
				style:transform={`translateY(${marker.current.y}px)`}
				style:height={`${marker.current.height}px`}
			></span>
			{@render branches(tree)}
		</div>
	</nav>
{/if}

<style>
	nav {
		font-size: 0.8125rem;
	}
	.toc-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.375rem;
	}
	p {
		margin: 0;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-muted);
	}
	button {
		color: var(--color-muted);
		cursor: pointer;
		border-radius: 0.25rem;
	}
	.mode-toggle {
		font-size: 0.6875rem;
		padding: 0.25rem;
	}
	.toc-list {
		position: relative;
		padding-left: 0.25rem;
	}
	.position-marker {
		position: absolute;
		top: 0;
		left: 0;
		width: 2px;
		border-radius: 2px;
		background: var(--color-accent);
		pointer-events: none;
	}
	.toc-branches {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.toc-branches.nested {
		margin-left: 0.5rem;
		padding-left: 0.5rem;
		border-left: 1px solid var(--color-border);
	}
	.toc-row {
		display: flex;
		align-items: flex-start;
	}
	.branch-toggle,
	.leaf-spacer {
		flex: 0 0 1rem;
		width: 1rem;
		height: 1.625rem;
		display: grid;
		place-items: center;
	}
	svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		transition: transform 180ms;
	}
	svg.open {
		transform: rotate(90deg);
	}
	a {
		display: block;
		min-width: 0;
		flex: 1;
		border-radius: 0.25rem;
		padding: 0.25rem;
		color: var(--color-muted);
		line-height: 1.4;
		overflow-wrap: anywhere;
		text-decoration: none;
		transition:
			color 120ms,
			background-color 120ms;
	}
	a.parent {
		font-weight: 500;
		color: var(--color-text);
	}
	a[aria-current],
	a:hover,
	button:hover {
		color: var(--color-accent);
	}
	a[aria-current] {
		background: var(--color-surface);
	}
	a:focus-visible,
	button:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}
	.parent-context {
		padding: 0.25rem 0.25rem 0 1.25rem;
		font-size: 0.625rem;
		color: var(--color-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@media (prefers-reduced-motion: reduce) {
		svg,
		a {
			transition: none;
		}
	}
</style>
