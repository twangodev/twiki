<script lang="ts">
	import {
		BookOpen,
		Check,
		ChevronRight,
		Copy,
		Download,
		File,
		Folder,
		ArrowUpRight
	} from '@lucide/svelte';
	import { fileRoute, fileSize } from '$lib/files';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	let copied = $state(false);
	let copyFailed = $state(false);
	const name = $derived(data.path.split('/').at(-1) || data.course);
	const segments = $derived(data.path.split('/').filter(Boolean));
	const action =
		'inline-flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-muted no-underline hover:bg-surface hover:text-text';
	$effect(() => {
		data.path;
		copied = false;
		copyFailed = false;
	});
	async function copy() {
		try {
			await navigator.clipboard.writeText(data.preview?.text ?? '');
			copied = true;
			copyFailed = false;
		} catch {
			copyFailed = true;
		}
	}
</script>

<svelte:head>
	<title>{name} · Files · Wisconsin</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div data-pagefind-ignore>
	<nav
		class="mb-5 flex flex-wrap items-center gap-1 text-xs text-muted"
		aria-label="File breadcrumbs"
	>
		<a class="hover:text-text" href={`/${encodeURIComponent(data.course)}`}>{data.course}</a>
		<ChevronRight size={12} />
		<a class="hover:text-text" href={fileRoute(data.course)}>Files</a>
		{#each segments as segment, i}
			<ChevronRight size={12} />
			<a
				class="break-all hover:text-text"
				href={fileRoute(data.course, segments.slice(0, i + 1).join('/'))}
				aria-current={i === segments.length - 1 ? 'page' : undefined}>{segment}</a
			>
		{/each}
	</nav>
	<header class="mb-4 flex flex-wrap items-center justify-between gap-3">
		<div class="min-w-0">
			<h1 class="m-0 break-all text-xl font-semibold tracking-tight">{name}</h1>
			<p class="mt-1 text-xs text-muted">
				{data.file ? fileSize(data.file.size) : `${data.entries?.length ?? 0} items`}
			</p>
		</div>
		{#if data.file}
			<div class="flex flex-wrap items-center gap-1">
				{#if data.file.note}<a class={action} href={data.file.note}
						><BookOpen size={14} />Read note</a
					>{/if}
				{#if data.preview}<button class={action} onclick={copy}
						>{#if copied}<Check size={14} />Copied{:else}<Copy size={14} />{data.preview.truncated
								? 'Copy preview'
								: 'Copy'}{/if}</button
					>{/if}
				{#if data.file.download}
					{#if data.file.kind === 'pdf' || data.file.kind === 'image'}<a
							class={action}
							href={data.file.download}
							target="_blank"
							rel="noopener noreferrer"><ArrowUpRight size={14} />Open</a
						>{/if}
					<a class={action} href={data.file.download} download={name}
						><Download size={14} />Download</a
					>
				{/if}
			</div>
		{/if}
	</header>
	{#if copyFailed}<p class="mb-3 text-xs text-muted" role="status">
			Clipboard unavailable. Select and copy the code below.
		</p>{/if}
	{#if data.preview}
		{#if data.preview.truncated}<p class="mb-3 text-xs text-muted">
				Showing a limited preview. Download the file for the complete content.
			</p>{/if}
		<div
			class="file-code overflow-x-auto rounded-md border border-border"
			role="region"
			aria-label="Source code"
		>
			{@html data.preview.html}
		</div>
	{:else if data.file?.kind === 'pdf'}
		<iframe
			class="h-[75dvh] min-h-96 w-full rounded-md border border-border"
			title={name}
			src={data.file.download}
		></iframe>
	{:else if data.file?.kind === 'image'}
		<div class="flex min-h-64 justify-center rounded-md border border-border bg-surface p-4">
			<img class="max-h-[75dvh] max-w-full object-contain" src={data.file.download} alt={name} />
		</div>
	{:else if data.file}
		<div class="rounded-md border border-border py-16 text-center text-sm text-muted">
			<File class="mx-auto mb-3" size={28} />
			<p>
				{data.file.download
					? 'No preview for this file type. Download it to open locally.'
					: 'This file exceeds the hosting size limit and is not available for download.'}
			</p>
		</div>
	{:else}
		<ul
			class="m-0 list-none divide-y divide-border rounded-md border border-border p-0"
			aria-label="Directory contents"
		>
			{#each data.entries ?? [] as entry (entry.path)}
				<li>
					<a
						class="flex min-w-0 items-center gap-3 px-3 py-2.5 text-sm text-text no-underline hover:bg-surface"
						href={fileRoute(data.course, entry.path)}
					>
						{#if entry.children}<Folder class="shrink-0 text-muted" size={16} />{:else}<File
								class="shrink-0 text-muted"
								size={16}
							/>{/if}
						<span class="min-w-0 flex-1 truncate">{entry.name}</span><span
							class="shrink-0 text-xs text-muted"
							>{entry.file ? fileSize(entry.file.size) : `${entry.children?.length} items`}</span
						>
					</a>
				</li>
			{:else}<li class="p-4 text-sm text-muted">No browsable files in this course.</li>{/each}
		</ul>
	{/if}
</div>

<style>
	.file-code :global(pre) {
		margin: 0;
		padding: 1rem 0;
		background: var(--color-bg) !important;
		font-size: 0.75rem;
		line-height: 1.65;
		tab-size: 4;
	}
	.file-code :global(code) {
		display: block;
		min-width: max-content;
		counter-reset: line;
	}
	.file-code :global(.line) {
		display: inline-block;
		min-width: 100%;
		padding-right: 1rem;
	}
	.file-code :global(.line::before) {
		counter-increment: line;
		content: counter(line);
		display: inline-block;
		width: 4rem;
		margin-right: 1rem;
		padding-right: 1rem;
		text-align: right;
		color: var(--color-muted);
		border-right: 1px solid var(--color-border);
		user-select: none;
	}
	:global(.dark) .file-code :global(span) {
		color: var(--shiki-dark) !important;
	}
</style>
