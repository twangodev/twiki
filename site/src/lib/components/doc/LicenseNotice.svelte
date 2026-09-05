<script lang="ts">
	import type { ContentLicense } from '$lib/content-license';
	const { license }: { license: ContentLicense } = $props();
</script>

<svelte:head><link rel="license" href={license.url} /></svelte:head>

<aside
	aria-label="Content license"
	class="border-t border-border py-3 text-xs leading-relaxed text-muted"
	data-pagefind-ignore
>
	<a
		href={license.source}
		class="text-muted underline decoration-border underline-offset-2 hover:text-text"
		>{license.attribution}</a
	>
	·
	<a
		href={license.url}
		rel="license"
		class="text-muted underline decoration-border underline-offset-2 hover:text-text"
		>{license.name}</a
	>, unless otherwise noted.
	{#if license.changes}<p class="m-0 mt-1">{license.changes}</p>{/if}
</aside>
