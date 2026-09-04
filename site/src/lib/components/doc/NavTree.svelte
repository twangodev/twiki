<script lang="ts">
	import type { NavNode } from '$lib/types';
	import Self from './NavTree.svelte';
	import { page } from '$app/state';
	import { slide } from 'svelte/transition';
	import { prefersReducedMotion } from 'svelte/motion';
	import { ChevronRight } from '@lucide/svelte';
	let {
		nodes,
		depth = 0,
		expanded = $bindable({})
	}: {
		nodes: NavNode[];
		depth?: number;
		expanded?: Record<string, boolean>;
	} = $props();
	const uid = $props.id();
	const currentPath = $derived(decodeURI(page.url.pathname).replace(/\/$/, '') || '/');
	function key(node: NavNode) {
		return node.route ?? `${depth}-${node.segment}`;
	}
	function active(node: NavNode): boolean {
		return node.route === currentPath;
	}
	function containsActive(node: NavNode): boolean {
		return active(node) || node.children.some(containsActive);
	}
	function open(node: NavNode) {
		return expanded[key(node)] ?? containsActive(node);
	}
</script>

<ul class:nested={depth > 0}>
	{#each nodes as node (node.segment)}
		<li>
			<div class="row" class:active={active(node)}>
				{#if node.children.length}
					<button
						aria-label={`Toggle ${node.title}`}
						aria-expanded={open(node)}
						aria-controls={`${uid}-${node.segment}`}
						onclick={() => (expanded = { ...expanded, [key(node)]: !open(node) })}
					>
						<ChevronRight size={13} class={open(node) ? 'expanded' : ''} />
					</button>
				{:else}<span class="spacer"></span>{/if}
				{#if node.route}
					<a
						href={node.route}
						title={node.title}
						aria-current={active(node) ? 'page' : undefined}
						class:section={node.children.length > 0}>{node.title}</a
					>
				{:else}<span class="label">{node.title}</span>{/if}
			</div>
			<div id={`${uid}-${node.segment}`}>
				{#if node.children.length && open(node)}
					<div transition:slide={{ duration: prefersReducedMotion.current ? 0 : 150 }}>
						<Self nodes={node.children} depth={depth + 1} bind:expanded />
					</div>
				{/if}
			</div>
		</li>
	{/each}
</ul>

<style>
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	ul.nested {
		margin-left: 0.5rem;
		padding-left: 0.375rem;
		border-left: 1px solid var(--color-border);
	}
	.row {
		display: flex;
		align-items: flex-start;
		position: relative;
		border-radius: 0.25rem;
	}
	.row.active {
		background: var(--color-accent-soft, #f7e4e1);
	}
	.row.active::before {
		content: '';
		position: absolute;
		inset: 3px auto 3px 0;
		width: 2px;
		border-radius: 2px;
		background: var(--color-accent);
	}
	button,
	.spacer {
		flex: 0 0 1.125rem;
		width: 1.125rem;
		height: 1.875rem;
		display: grid;
		place-items: center;
	}
	button {
		cursor: pointer;
		color: var(--color-muted);
	}
	button :global(svg) {
		transition: transform 150ms;
	}
	button :global(.expanded) {
		transform: rotate(90deg);
	}
	a,
	.label {
		padding: 0.375rem 0.25rem;
		font-size: 0.8125rem;
		line-height: 1.4;
		color: var(--color-muted);
		text-decoration: none;
		overflow-wrap: anywhere;
		min-width: 0;
		flex: 1;
	}
	a {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	a.section {
		font-weight: 500;
		color: var(--color-text);
	}
	a[aria-current] {
		color: var(--color-accent);
		font-weight: 500;
	}
	.row:hover {
		background: var(--color-surface);
	}
	a:focus-visible,
	button:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: -1px;
		border-radius: 3px;
	}
	@media (prefers-reduced-motion: reduce) {
		button :global(svg) {
			transition: none;
		}
	}
</style>
