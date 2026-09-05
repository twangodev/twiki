<script lang="ts">
	import {
		BookOpen,
		Check,
		ChevronRight,
		Copy,
		Download,
		Pin,
		File,
		ArrowUpRight
	} from '@lucide/svelte';
	import { fileRoute, fileSize } from '$lib/files';
	import FileIcon from '$lib/components/files/FileIcon.svelte';
	import FileTabs from '$lib/components/files/FileTabs.svelte';
	import FileCode from '$lib/components/files/FileCode.svelte';
	import { fileWorkspace } from '$lib/components/files/file-workspace.svelte';
	import { sameFile } from '$lib/file-tabs';
	import { beforeNavigate } from '$app/navigation';
	import { onMount, tick, untrack } from 'svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const workspace = fileWorkspace();
	let viewport = $state<HTMLElement>();
	const activeTab = $derived(workspace.tabs.find((tab) => sameFile(tab, data)));
	function rememberPosition() {
		if (data.file && viewport) workspace.remember(data.course, data.path, viewport);
	}
	beforeNavigate(rememberPosition);
	onMount(() => {
		window.addEventListener('pagehide', rememberPosition);
		return () => window.removeEventListener('pagehide', rememberPosition);
	});
	$effect(() => {
		const { course, path, file } = data;
		if (!workspace.ready || !viewport) return;
		const position = untrack(() => {
			if (file) workspace.open(course, path);
			return workspace.tabs.find((tab) => sameFile(tab, { course, path }));
		});
		void tick().then(() => {
			if (viewport && data.course === course && data.path === path)
				viewport.scrollTo({
					top: position?.top ?? 0,
					left: position?.left ?? 0,
					behavior: 'instant'
				});
		});
	});
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

<div class="flex h-full min-h-0 flex-col" data-pagefind-ignore>
	<div class="flex shrink-0 flex-col border-b border-border">
		<nav
			class="flex items-center gap-1 overflow-x-auto px-3 py-1.5 text-xs whitespace-nowrap text-muted"
			aria-label="File breadcrumbs"
		>
			<a class="hover:text-text" href={`/${encodeURIComponent(data.course)}`}>{data.course}</a>
			<ChevronRight size={12} />
			<a class="hover:text-text" href={fileRoute(data.course)}>Files</a>
			{#each segments as segment, i}
				<ChevronRight size={12} />
				<a
					class="hover:text-text"
					href={fileRoute(data.course, segments.slice(0, i + 1).join('/'))}
					aria-current={i === segments.length - 1 ? 'page' : undefined}>{segment}</a
				>
			{/each}
		</nav>
		<header class="order-first flex min-w-0 items-center border-b border-border bg-surface pr-2">
			{#if !data.file && !workspace.tabs.length}<div
					class="flex min-w-0 items-center gap-2 border-r border-border bg-bg px-3 py-2"
				>
					<FileIcon {name} folder={!data.file} expanded={!data.file} />
					<h1 class="m-0 break-all font-mono text-xs font-medium">{name}</h1>
				</div>{:else}<h1 class="sr-only">{name}</h1>{/if}
			<FileTabs course={data.course} path={data.path} isFile={!!data.file} />
			{#if data.file}
				<div class="flex shrink-0 items-center gap-1">
					{#if !activeTab?.pinned}<button
							class={action}
							title="Keep this preview open"
							aria-label="Keep file open"
							disabled={!workspace.ready}
							onclick={() => workspace.open(data.course, data.path, true)}><Pin size={14} /></button
						>{/if}
					{#if data.file.note}<a class={action} href={data.file.note}
							><BookOpen size={14} />Read note</a
						>{/if}
					{#if data.preview}<button class={action} onclick={copy}
							>{#if copied}<Check size={14} />Copied{:else}<Copy size={14} />Copy{/if}</button
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
	</div>
	{#if copyFailed}<p class="px-3 py-2 text-xs text-muted" role="status">
			Clipboard unavailable. Select and copy the code below.
		</p>{/if}
	{#if data.preview}
		<div class="min-h-0 min-w-0 flex-1">
			{#key `${data.course}/${data.path}`}
				<FileCode
					text={data.preview.text}
					filename={name}
					onready={(element) => (viewport = element)}
				/>
			{/key}
		</div>
	{:else}
		<div class="file-content min-h-0 flex-1 overflow-auto" bind:this={viewport}>
			{#if data.file?.kind === 'pdf'}
				<iframe class="block h-full w-full border-0" title={name} src={data.file.download}></iframe>
			{:else if data.file?.kind === 'image'}
				<div class="flex h-full justify-center bg-surface">
					<img class="max-h-full max-w-full object-contain" src={data.file.download} alt={name} />
				</div>
			{:else if data.file}
				<div
					class="flex h-full flex-col items-center justify-center px-3 text-center text-sm text-muted"
				>
					<File class="mx-auto mb-3" size={28} />
					<p>
						{data.file.download
							? 'No preview for this file type. Download it to open locally.'
							: 'This file exceeds the hosting size limit and is not available for download.'}
					</p>
				</div>
			{:else}
				<ul class="m-0 list-none divide-y divide-border p-0" aria-label="Directory contents">
					{#each data.entries ?? [] as entry (entry.path)}
						<li>
							<a
								class="flex min-w-0 items-center gap-3 px-3 py-2.5 text-sm text-text no-underline hover:bg-surface"
								href={fileRoute(data.course, entry.path)}
								onclick={(event) => {
									if (entry.file) workspace.activate(event, data.course, entry.path);
								}}
							>
								<FileIcon name={entry.name} folder={!!entry.children} />
								<span class="min-w-0 flex-1 truncate">{entry.name}</span><span
									class="shrink-0 text-xs text-muted"
									>{entry.file
										? fileSize(entry.file.size)
										: `${entry.children?.length} items`}</span
								>
							</a>
						</li>
					{:else}<li class="p-4 text-sm text-muted">No browsable files in this course.</li>{/each}
				</ul>
			{/if}
		</div>
	{/if}
	<footer
		class="flex shrink-0 items-center justify-between border-t border-border bg-surface px-3 py-1 text-[0.6875rem] text-muted"
	>
		<span
			>{data.preview
				? `${data.preview.text.split('\n').length} lines · UTF-8`
				: data.file?.kind === 'pdf'
					? 'PDF'
					: data.file?.kind === 'image'
						? 'Image'
						: 'Files'}</span
		>
		<span
			>{data.file
				? `${fileSize(data.file.size)} · Read-only`
				: `${data.entries?.length ?? 0} items`}</span
		>
	</footer>
</div>
