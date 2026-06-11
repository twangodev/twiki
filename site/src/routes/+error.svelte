<script lang="ts">
	import { page } from '$app/state';
	import SEO from '$lib/components/SEO.svelte';
</script>

<SEO title={String(page.status)} noindex />

<article class="prose dark:prose-invert max-w-none">
	<h1>{page.status}</h1>
	{#if page.status === 404}
		<p>Either this page is private or doesn't exist.</p>
	{:else}
		<p>{page.error?.message ?? 'Something went wrong.'}</p>
	{/if}
	<p><a href="/">Go back to the homepage</a></p>
</article>
