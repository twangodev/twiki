<script lang="ts">
	import { Copy, FileText, ChevronDown } from '@lucide/svelte';
	import { Popover } from 'bits-ui';
	import { textExportUrl } from '$lib/text-exports';

	let { slug }: { slug: string } = $props();
	let open = $state(false);
	let status = $state('');
	let busy = $state(false);
	let markdown = $state<string>();
	let loading = $state(false);
	const actionClass =
		'flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm text-text no-underline hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50';

	// Fetch while the menu is opening so clipboard writes start directly from
	// the click, without a network await consuming browser user activation.
	async function prepareMarkdown() {
		if (markdown !== undefined || loading) return;
		loading = true;
		try {
			const response = await fetch(textExportUrl(slug));
			if (
				!response.ok ||
				response.redirected ||
				response.headers.get('content-type')?.includes('text/html')
			)
				throw new Error('Text export unavailable');
			markdown = await response.text();
			status = '';
		} catch {
			status = 'Could not load Markdown. Use the text links below.';
		} finally {
			loading = false;
		}
	}

	async function copy() {
		if (markdown === undefined || busy) return;
		busy = true;
		status = '';
		try {
			await navigator.clipboard.writeText(markdown);
			status = 'Markdown copied.';
		} catch {
			status = 'Could not copy. Open Markdown below to copy manually.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="not-prose mb-5" data-pagefind-ignore>
	<Popover.Root
		bind:open
		onOpenChange={(value) => {
			if (value) void prepareMarkdown();
		}}
	>
		<Popover.Trigger
			openOnHover
			openDelay={150}
			closeDelay={250}
			class="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted hover:bg-surface hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
		>
			<Copy class="size-3.5" aria-hidden="true" />Use this note<ChevronDown
				class="size-3"
				aria-hidden="true"
			/>
		</Popover.Trigger>
		<Popover.Portal>
			<Popover.Content
				role="dialog"
				aria-label="Note actions"
				side="bottom"
				align="start"
				sideOffset={4}
				collisionPadding={12}
				class="not-prose z-50 w-64 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-bg p-1 text-text shadow-md"
			>
				<button class={actionClass} disabled={busy || markdown === undefined} onclick={() => copy()}
					><Copy class="size-4" aria-hidden="true" />Copy Markdown</button
				>
				<div class="my-1 border-t border-border"></div>
				<a
					class={actionClass}
					href={textExportUrl(slug)}
					data-sveltekit-reload
					data-no-popover="true"
					><FileText class="size-4" aria-hidden="true" />View Markdown
					<span class="ml-auto text-xs text-muted">.md</span></a
				>
				<a
					class={actionClass}
					href={textExportUrl(slug, 'txt')}
					data-sveltekit-reload
					data-no-popover="true"
					><FileText class="size-4" aria-hidden="true" />View text
					<span class="ml-auto text-xs text-muted">.txt</span></a
				>
				<p class="m-0 px-2.5 text-xs text-muted" role="status">
					{loading ? 'Loading Markdown…' : status}
				</p>
			</Popover.Content>
		</Popover.Portal>
	</Popover.Root>
</div>
