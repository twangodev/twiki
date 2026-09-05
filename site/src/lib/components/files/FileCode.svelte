<script lang="ts">
	import { onMount } from 'svelte';
	let {
		text,
		filename,
		onready
	}: { text: string; filename: string; onready?: (viewport: HTMLElement) => void } = $props();
	let host: HTMLDivElement;
	let failed = $state(false);
	onMount(() => {
		let disposed = false;
		let destroy: (() => void) | undefined;
		void import('./code-view')
			.then(({ createCodeView }) => {
				if (disposed) return;
				const editor = createCodeView(host, text, filename);
				destroy = editor.destroy;
				editor.view.requestMeasure({
					read: () => null,
					write: () => onready?.(editor.view.scrollDOM)
				});
			})
			.catch(() => {
				failed = true;
			});
		return () => {
			disposed = true;
			destroy?.();
		};
	});
</script>

<div class="file-code h-full min-w-0" bind:this={host}>
	{#if failed}<pre class="h-full overflow-auto p-2 text-xs">{text}</pre>{/if}
</div>
