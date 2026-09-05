<script lang="ts">
	import { page } from '$app/state';
	import { tick, untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import { prefersReducedMotion } from 'svelte/motion';
	import { ChevronsUpDown, LogOut } from '@lucide/svelte';
	import type { NavNode } from '$lib/types';
	import { site } from '$lib/config';
	import { ThemeToggle } from '$lib/components/ui';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import NavTree from './NavTree.svelte';
	import ReaderModeToggle from './ReaderModeToggle.svelte';
	import { SearchButton } from '$lib/components/search';

	const { nav }: { nav: NavNode[] } = $props();
	const uid = $props.id();
	const path = $derived(decodeURI(page.url.pathname));
	const course = $derived(
		nav.find((node) => node.children.length && path.split('/')[1] === node.segment)
	);
	const courseNodes = $derived(
		(course?.children ?? [])
			.map((node) => ({
				...node,
				title:
					node.segment === 'README'
						? 'Overview'
						: ((
								{
									lectures: 'Lectures',
									homework: 'Homework',
									exams: 'Exams',
									projects: 'Projects'
								} as Record<string, string>
							)[node.title] ?? node.title)
			}))
			.sort((a, b) => Number(b.segment === 'README') - Number(a.segment === 'README'))
	);
	let choosing = $state(false);
	let query = $state('');
	let search = $state<HTMLInputElement>();
	let switcher: HTMLButtonElement;
	let viewport = $state<HTMLElement>();
	let expanded = $state<Record<string, boolean>>({});
	function semester(node: NavNode) {
		const match = /^(sp|su|fa|wi)(\d{2})-/.exec(node.segment);
		return match
			? `${{ sp: 'Spring', su: 'Summer', fa: 'Fall', wi: 'Winter' }[match[1]]} 20${match[2]}`
			: 'Other';
	}
	function label(node: NavNode) {
		return node.segment
			.replace(/^(sp|su|fa|wi)\d{2}-/, '')
			.replace(/([a-z])(\d)/, '$1 $2')
			.toUpperCase();
	}
	function landing(node: NavNode) {
		return node.children.find((child) => child.segment === 'README')?.route ?? node.route ?? '/';
	}
	function semesterOrder(node: NavNode) {
		const match = /^(sp|su|fa|wi)(\d{2})-/.exec(node.segment);
		return match ? Number(match[2]) * 10 + ['wi', 'sp', 'su', 'fa'].indexOf(match[1]) : -1;
	}
	const groups = $derived.by(() => {
		const result = new Map<string, NavNode[]>();
		for (const node of [...nav].sort(
			(a, b) =>
				semesterOrder(b) - semesterOrder(a) ||
				label(a).localeCompare(label(b), undefined, { numeric: true })
		)) {
			if (
				!node.children.length ||
				!`${label(node)} ${semester(node)} ${node.title}`
					.toLowerCase()
					.includes(query.toLowerCase().trim())
			)
				continue;
			const group = semester(node);
			result.set(group, [...(result.get(group) ?? []), node]);
		}
		return [...result];
	});
	async function toggleCourses() {
		choosing = !choosing;
		query = '';
		if (choosing) {
			await tick();
			search?.focus();
		}
	}
	$effect(() => {
		const current = path;
		untrack(() => {
			choosing = false;
			query = '';
			const next = { ...expanded };
			function reveal(nodes: NavNode[]): boolean {
				let found = false;
				for (const node of nodes) {
					const childActive = reveal(node.children);
					if (childActive && node.route) next[node.route] = true;
					if (childActive || node.route === current) found = true;
				}
				return found;
			}
			reveal(nav);
			expanded = next;
		});
	});
	$effect(() => {
		path;
		if (!viewport) return;
		const timer = setTimeout(() => {
			const link = viewport?.querySelector<HTMLElement>('[aria-current="page"]');
			if (!link || !viewport || !link.getClientRects().length) return;
			const bounds = viewport.getBoundingClientRect(),
				row = link.getBoundingClientRect();
			if (row.top < bounds.top || row.bottom > bounds.bottom)
				viewport.scrollTo({
					top:
						viewport.scrollTop + row.top - bounds.top - viewport.clientHeight / 2 + row.height / 2,
					behavior: prefersReducedMotion.current ? 'instant' : 'smooth'
				});
		}, 200);
		return () => clearTimeout(timer);
	});
</script>

<div class="doc-sidebar-content flex h-full min-h-0 flex-col gap-3">
	<a class="text-[1.05rem] font-bold tracking-[-0.01em] text-text no-underline" href="/"
		>{site.name}</a
	>
	<SearchButton />
	<button
		class="course-switcher"
		bind:this={switcher}
		aria-expanded={choosing || !course}
		aria-controls={`${uid}-courses`}
		onclick={toggleCourses}
	>
		<span
			><small>{course ? semester(course) : 'Workspace'}</small><strong
				>{course ? label(course) : 'Browse courses'}</strong
			></span
		>
		<ChevronsUpDown size={15} />
	</button>
	<nav
		id={`${uid}-courses`}
		class="course-navigation min-h-0 flex-1 overflow-y-auto"
		aria-label="Documentation"
		bind:this={viewport}
	>
		{#if choosing || !course}
			<div>
				<input
					bind:this={search}
					bind:value={query}
					aria-label="Find a course"
					placeholder="Find a course…"
					onkeydown={(event) => {
						if (event.key === 'Escape') {
							choosing = false;
							query = '';
							switcher.focus();
						}
					}}
				/>
				{#each groups as [name, courses]}
					<p class="group-label">{name}</p>
					{#each courses as item}
						<a
							class="course-option"
							href={landing(item)}
							onclick={() => (choosing = false)}
							aria-current={item === course ? 'true' : undefined}>{label(item)}</a
						>
					{/each}
				{/each}
				{#if !groups.length}<p class="empty">No courses match “{query}”.</p>{/if}
				<div class="workspace-links">
					<a class="course-option" href="/">Workspace home</a>
					{#each nav.filter((node) => !node.children.length && node.route) as node}<a
							class="course-option"
							href={node.route}>{node.title}</a
						>{/each}
				</div>
			</div>
		{:else}
			{#key course.segment}
				<div in:fade={{ duration: prefersReducedMotion.current ? 0 : 120 }}>
					<NavTree nodes={courseNodes} bind:expanded />
				</div>
			{/key}
		{/if}
	</nav>
	<div class="flex shrink-0 items-center justify-between border-t border-border pt-3">
		<ThemeToggle /><ReaderModeToggle />
		<form method="post" action="/logout">
			<IconButton type="submit" aria-label="Sign out" title="Sign out"
				><LogOut size={16} /></IconButton
			>
		</form>
	</div>
</div>

<style>
	.course-switcher {
		display: flex;
		justify-content: space-between;
		align-items: center;
		text-align: left;
		padding: 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		cursor: pointer;
		color: var(--color-text);
	}
	.course-switcher small,
	.course-switcher strong {
		display: block;
	}
	.course-switcher small {
		font-size: 0.625rem;
		color: var(--color-muted);
		margin-bottom: 0.125rem;
	}
	.course-switcher strong {
		font-size: 0.8125rem;
		font-weight: 600;
	}
	.course-navigation {
		scrollbar-width: thin;
		overflow-anchor: none;
		overscroll-behavior: contain;
	}
	input {
		width: 100%;
		padding: 0.5rem;
		font-size: 0.8125rem;
		border: 1px solid var(--color-border);
		border-radius: 0.25rem;
		background: var(--color-bg);
	}
	.group-label {
		margin: 1rem 0 0.25rem;
		padding-inline: 0.5rem;
		font-size: 0.625rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-muted);
	}
	.course-option {
		display: block;
		padding: 0.375rem 0.5rem;
		color: var(--color-text);
		font-size: 0.8125rem;
		text-decoration: none;
		border-radius: 0.25rem;
	}
	.course-option:hover,
	.course-switcher:hover {
		background: var(--color-surface);
	}
	.course-option[aria-current] {
		color: var(--color-accent);
	}
	.workspace-links {
		border-top: 1px solid var(--color-border);
		margin-top: 1rem;
		padding-top: 0.5rem;
	}
	.empty {
		font-size: 0.8125rem;
		color: var(--color-muted);
		padding: 0.5rem;
	}
	button:focus-visible,
	a:focus-visible,
	input:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: -1px;
	}
</style>
