<script lang="ts">
	import { enhance } from '$app/forms';
	import { ShieldCheck, UserPlus } from '@lucide/svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Access · Wisconsin</title></svelte:head>

<section class="mx-auto w-full max-w-xl">
	<header class="mb-6">
		<h1 class="mb-2 text-3xl font-semibold tracking-tight">Access</h1>
		<p class="text-sm text-muted">
			Approved people can read all courses. Only you can manage access.
		</p>
	</header>

	<form method="POST" action="?/add" use:enhance class="mb-6">
		<label for="github-username" class="mb-2 block text-sm font-medium">GitHub username</label>
		<div class="flex gap-2">
			<input
				id="github-username"
				name="username"
				required
				maxlength="40"
				autocomplete="off"
				autocapitalize="none"
				spellcheck="false"
				placeholder="username"
				class="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent"
			/>
			<button
				class="flex shrink-0 items-center gap-2 rounded-lg bg-text px-3 py-2 text-sm font-medium text-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
				><UserPlus size={16} />Add access</button
			>
		</div>
	</form>

	{#if form?.error}<p role="alert" class="mb-4 text-sm text-accent">{form.error}</p>{/if}
	{#if form?.message}<p role="status" class="mb-4 text-sm text-muted">{form.message}</p>{/if}

	<ul
		class="m-0 list-none divide-y divide-border border-y border-border p-0"
		aria-label="People with access"
	>
		<li class="flex items-center justify-between gap-3 py-4">
			<div>
				<p class="font-medium">You</p>
				<p class="text-xs text-muted">GitHub ID {data.ownerId}</p>
			</div>
			<span class="flex items-center gap-1.5 text-xs text-muted"
				><ShieldCheck size={14} />Owner</span
			>
		</li>
		{#each data.grants as grant (grant.githubId)}
			<li class="flex items-center justify-between gap-3 py-4">
				<div class="min-w-0">
					<a
						class="font-medium text-text hover:text-accent"
						href={`https://github.com/${grant.githubLogin}`}
						target="_blank"
						rel="noreferrer">@{grant.githubLogin}</a
					>
					<p class="text-xs text-muted">GitHub ID {grant.githubId}</p>
				</div>
				<form
					method="POST"
					action="?/revoke"
					use:enhance={({ cancel }) => {
						if (!confirm(`Revoke @${grant.githubLogin}'s access and sign out their sessions?`))
							cancel();
					}}
				>
					<input type="hidden" name="githubId" value={grant.githubId} />
					<button
						class="rounded-md px-2 py-1 text-sm text-muted hover:bg-accent-soft hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
						aria-label={`Revoke @${grant.githubLogin}`}>Revoke</button
					>
				</form>
			</li>
		{/each}
	</ul>
	{#if !data.grants.length}<p class="mt-4 text-sm text-muted">Only you have access.</p>{/if}
</section>
