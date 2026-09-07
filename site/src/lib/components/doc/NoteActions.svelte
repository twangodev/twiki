<script lang="ts">
	import { Copy, FileText } from '@lucide/svelte';
	import { siClaude } from 'simple-icons';
	// OpenAI was removed in later Simple Icons releases.
	import { siOpenai } from 'simple-icons-openai';
	import { textExportUrl } from '$lib/text-exports';
	let { slug }: { slug: string } = $props();
	let status = $state('');
	let busy = $state(false);
	const actionClass =
		'inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted hover:bg-surface hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50';

	async function copy(destination?: 'Claude' | 'ChatGPT') {
		busy = true;
		status = '';
		// Open synchronously to preserve the browser's user-activation permission.
		const tab = destination ? window.open('about:blank', '_blank') : null;
		if (tab) tab.opener = null;
		try {
			const response = await fetch(textExportUrl(slug));
			if (
				!response.ok ||
				response.redirected ||
				response.headers.get('content-type')?.includes('text/html')
			)
				throw new Error('Text export unavailable');
			await navigator.clipboard.writeText(await response.text());
			if (destination && tab) {
				tab.location.href =
					destination === 'Claude' ? 'https://claude.ai/new' : 'https://chatgpt.com/';
				status = `Copied. Paste into ${destination} to start.`;
			} else {
				status = destination
					? `Copied. Open ${destination} and paste to start.`
					: 'Markdown copied.';
			}
		} catch {
			tab?.close();
			status = 'Could not copy. Open the .md link to copy manually.';
		} finally {
			busy = false;
		}
	}
</script>

<div
	class="not-prose mb-5 flex flex-wrap items-center gap-1"
	data-pagefind-ignore
	aria-label="Note actions"
>
	<button class={actionClass} disabled={busy} onclick={() => copy()}
		><Copy class="size-3.5" aria-hidden="true" />Copy Markdown</button
	>
	<button
		class={actionClass}
		disabled={busy}
		onclick={() => copy('Claude')}
		title="Copy Markdown and open Claude; paste to start"
	>
		<svg viewBox="0 0 24 24" class="size-3.5" fill="currentColor" aria-hidden="true"
			><path d={siClaude.path} /></svg
		>Open in Claude
	</button>
	<button
		class={actionClass}
		disabled={busy}
		onclick={() => copy('ChatGPT')}
		title="Copy Markdown and open ChatGPT; paste to start"
		><svg viewBox="0 0 24 24" class="size-3.5" fill="currentColor" aria-hidden="true"
			><path d={siOpenai.path} /></svg
		>Open in ChatGPT</button
	>
	<a class={actionClass} href={textExportUrl(slug)}
		><FileText class="size-3.5" aria-hidden="true" />.md</a
	>
	<a class={actionClass} href={textExportUrl(slug, 'txt')}>.txt</a>
	<span class="w-full px-2 text-xs text-muted" role="status">{status}</span>
</div>
