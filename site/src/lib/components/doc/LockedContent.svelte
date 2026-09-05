<script lang="ts">
	import { LockKeyhole } from '@lucide/svelte';
	import { page } from '$app/state';
</script>

<div
	class="flex items-start gap-3 rounded-md border border-border p-4 text-sm"
	data-pagefind-ignore
>
	<LockKeyhole class="mt-0.5 size-4 shrink-0 text-muted" />
	<div>
		<p class="m-0 font-medium">Content locked</p>
		<p class="mt-1 mb-3 text-muted">
			The catalog is public. Reading this content requires approved access.
		</p>
		<a
			data-sveltekit-reload
			class="text-accent hover:underline"
			href={`/login?next=${encodeURIComponent(page.url.pathname)}`}>Sign in to read</a
		>
	</div>
</div>
