<script lang="ts">
	interface Props {
		/** Display route of the current page, no leading slash ('' = home). */
		route: string;
		/** Title for the final (unlinked) crumb. */
		current: string;
	}

	const { route, current }: Props = $props();

	const crumbs = $derived.by(() => {
		const segments = route === '' ? [] : route.split('/');
		const parents = segments.slice(0, -1).map((segment, i) => ({
			label: segment,
			href: '/' + segments.slice(0, i + 1).join('/')
		}));
		return parents;
	});
</script>

{#if route !== ''}
	<nav class="mb-3 text-[0.8125rem] text-muted" aria-label="Breadcrumbs">
		<ol class="m-0 flex list-none flex-wrap items-center gap-1 p-0">
			<li><a class="text-muted no-underline hover:text-accent" href="/">Home</a></li>
			{#each crumbs as crumb (crumb.href)}
				<li aria-hidden="true" class="select-none">❯</li>
				<li>
					<a class="text-muted no-underline hover:text-accent" href={crumb.href}>{crumb.label}</a>
				</li>
			{/each}
			<li aria-hidden="true" class="select-none">❯</li>
			<li aria-current="page" class="text-text">{current}</li>
		</ol>
	</nav>
{/if}
