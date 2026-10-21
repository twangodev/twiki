<script lang="ts">
	import type { RmdPreview } from '$lib/files';
	let { url, revision, unavailable }: { url: string; revision: unknown; unavailable: () => void } =
		$props();
	let preview = $state<RmdPreview>();
	let failed = $state(false);
	$effect(() => {
		// Content invalidation must recheck renderer provenance even when this URL is unchanged.
		revision;
		const selected = url;
		const abort = new AbortController();
		preview = undefined;
		failed = false;
		void (async () => {
			try {
				const response = await fetch(selected, { signal: abort.signal });
				if (abort.signal.aborted) return;
				if (response.status === 204) {
					unavailable();
					return;
				}
				if (!response.ok) throw new Error('Preview unavailable');
				const result: RmdPreview = await response.json();
				if (!abort.signal.aborted) preview = result;
			} catch {
				if (!abort.signal.aborted) failed = true;
			}
		})();
		return () => abort.abort();
	});
</script>

{#if preview}
	<article
		class="rmd-reading prose mx-auto max-w-3xl rounded border border-border bg-bg p-5 shadow-sm sm:p-10 dark:prose-invert"
		aria-label="Rendered worksheet"
	>
		<h1>{preview.title}</h1>
		{@html preview.html}
	</article>
{:else if failed}
	<p role="alert">
		Could not render the worksheet. Switch to Source or Interactive, or reload to try again.
	</p>
{:else}
	<p role="status">Rendering worksheet…</p>
{/if}
