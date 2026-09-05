<script lang="ts">
	import { onMount } from 'svelte';
	import { UsersRound } from '@lucide/svelte';

	let owner = $state(false);
	onMount(() => {
		const controller = new AbortController();
		fetch('/api/access', { signal: controller.signal })
			.then(async (response) => {
				if (response.ok) owner = (await response.json()).role === 'owner';
			})
			.catch(() => {});
		return () => controller.abort();
	});
</script>

{#if owner}
	<a
		href="/admin/access"
		aria-label="Manage access"
		title="Manage access"
		class="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
		><UsersRound size={16} /></a
	>
{/if}
