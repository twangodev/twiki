<script lang="ts">
	import { site } from '$lib/config';

	interface Props {
		title?: string;
		description?: string;
		canonical?: string;
		type?: 'website' | 'article';
		image?: string;
		noindex?: boolean;
		/** JSON-LD structured data (single object or array). */
		jsonLd?: Record<string, unknown> | Record<string, unknown>[];
	}

	const {
		title,
		description = site.description,
		canonical,
		type = 'website',
		image,
		noindex = false,
		jsonLd
	}: Props = $props();

	const fullTitle = $derived(title ? `${title} | ${site.name}` : site.name);
	const canonicalUrl = $derived(canonical ? `${site.url}${canonical}` : undefined);
	const jsonLdScripts = $derived(jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : []);

	// Build a <script type="application/ld+json"> tag. Split the literal closing
	// tag so the Svelte parser doesn't terminate this script block early. The
	// payload is our own serialized structured data, not user input.
	function jsonLdTag(schema: Record<string, unknown>): string {
		const open = '<' + 'script type="application/ld+json">';
		const close = '<' + '/script>';
		return open + JSON.stringify(schema) + close;
	}
</script>

<svelte:head>
	<title>{fullTitle}</title>
	<meta name="description" content={description} />
	{#if noindex}
		<meta name="robots" content="noindex, nofollow" />
	{/if}
	{#if canonicalUrl}
		<link rel="canonical" href={canonicalUrl} />
	{/if}

	<!-- Open Graph -->
	<meta property="og:title" content={fullTitle} />
	<meta property="og:description" content={description} />
	<meta property="og:type" content={type} />
	<meta property="og:site_name" content={site.name} />
	<meta property="og:locale" content={site.locale} />
	{#if canonicalUrl}
		<meta property="og:url" content={canonicalUrl} />
	{/if}
	{#if image}
		<meta property="og:image" content={image} />
	{/if}

	<!-- Twitter Card -->
	<meta name="twitter:card" content={image ? 'summary_large_image' : 'summary'} />
	<meta name="twitter:title" content={fullTitle} />
	<meta name="twitter:description" content={description} />
	{#if image}
		<meta name="twitter:image" content={image} />
	{/if}

	<!-- JSON-LD -->
	{#each jsonLdScripts as schema (schema)}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html jsonLdTag(schema)}
	{/each}
</svelte:head>
