<script lang="ts">
	import type { FileBlame } from '$lib/file-history';
	import type { createCodeView } from './code-view';
	let {
		text,
		url,
		filename,
		onready,
		onload,
		blame,
		oncommit = () => {}
	}: {
		text?: string;
		url?: string;
		filename: string;
		onready?: (viewport: HTMLElement) => void;
		onload?: (text: string) => void;
		blame?: FileBlame;
		oncommit?: (id: string) => void;
	} = $props();
	let editor = $state.raw<ReturnType<typeof createCodeView>>();
	let host: HTMLDivElement;
	let failed = $state(false);
	let loading = $state(true);
	let attempt = $state(0);
	$effect(() => {
		editor?.setBlame(blame, oncommit);
	});
	$effect(() => {
		const source = text,
			asset = url,
			name = filename;
		attempt;
		const controller = new AbortController();
		let created: ReturnType<typeof createCodeView> | undefined;
		failed = false;
		loading = true;
		const read = async () => {
			if (source !== undefined) return source;
			if (!asset) throw new Error('File unavailable');
			const response = await fetch(asset, { signal: controller.signal });
			if (!response.ok) throw new Error('File unavailable');
			return response.text();
		};
		void Promise.all([import('./code-view'), read()])
			.then(([{ createCodeView }, content]) => {
				if (controller.signal.aborted) return;
				onload?.(content);
				created = createCodeView(host, content, name);
				editor = created;
				loading = false;
				created.view.requestMeasure({
					read: () => null,
					write: () => {
						if (!controller.signal.aborted && created) onready?.(created.view.scrollDOM);
					}
				});
			})
			.catch(() => {
				if (!controller.signal.aborted) {
					failed = true;
					loading = false;
				}
			});
		return () => {
			controller.abort();
			created?.destroy();
			editor = undefined;
		};
	});
</script>

<div class="relative h-full min-w-0">
	{#if failed}<p class="absolute inset-x-0 top-0 p-3 text-xs text-muted" role="alert">
			Could not load the file. <button class="text-accent" onclick={() => attempt++}>Retry</button>
		</p>
	{:else if loading}<p class="absolute inset-x-0 top-0 p-3 text-xs text-muted" role="status">
			Loading file…
		</p>{/if}
	<div class="file-code h-full min-w-0" bind:this={host}></div>
</div>
