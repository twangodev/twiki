<script lang="ts">
	// Prerendered as 404.html; Workers `assets.not_found_handling: "404-page"`
	// serves it for any URL that matches neither an asset nor a route.
	import SEO from '$lib/components/SEO.svelte';
</script>

<SEO title="404" noindex />

<article class="prose dark:prose-invert max-w-none">
	<h1>404</h1>
	<p>Either this page is private or doesn't exist.</p>
	<p><a href="/">Go back to the homepage</a></p>
</article>
