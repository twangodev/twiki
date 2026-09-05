<script lang="ts">
	import themeData from '$lib/generated/file-icons.json';
	import { selectFileIcon, type FileIconTheme } from '$lib/file-icons';
	const {
		name,
		folder = false,
		expanded = false
	}: { name: string; folder?: boolean; expanded?: boolean } = $props();
	const icon = $derived(selectFileIcon(themeData as FileIconTheme, name, folder, expanded));
</script>

<span class="inline-flex size-4 shrink-0" aria-hidden="true" data-file-icon>
	<img
		src={`/_files/icons/${icon.light}.svg`}
		class={icon.light !== icon.dark ? 'size-4 dark:hidden' : 'size-4'}
		width="16"
		height="16"
		alt=""
	/>
	{#if icon.light !== icon.dark}<img
			src={`/_files/icons/${icon.dark}.svg`}
			class="hidden size-4 dark:block"
			width="16"
			height="16"
			alt=""
		/>{/if}
</span>
