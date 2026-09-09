<script lang="ts">
	import { onMount } from 'svelte';
	import type { WebR } from 'webr';
	import type { CourseFile } from '$lib/files';
	import { parseRmd, type RmdBlock } from '$lib/rmd';
	let {
		url,
		course,
		path,
		files,
		onload
	}: {
		url: string;
		course: string;
		path: string;
		files: CourseFile[];
		onload: (text: string) => void;
	} = $props();
	type Block = RmdBlock & { output?: string; plots?: string[]; done?: boolean };
	let title = $state('');
	let blocks = $state<Block[]>([]);
	let status = $state('Loading worksheet…');
	let busy = $state(false);
	let loaded = $state(false);
	let runtime: WebR | undefined;
	let runtimeReady = false;
	let generation = 0;
	const abort = new AbortController();
	const button =
		'rounded border border-border px-3 py-1.5 text-xs hover:bg-surface disabled:opacity-50';

	onMount(() => {
		void (async () => {
			try {
				const response = await fetch(url, { signal: abort.signal });
				if (!response.ok) throw new Error(`Worksheet unavailable (${response.status})`);
				const source = await response.text();
				const parsed = await parseRmd(source, course, path, files);
				if (abort.signal.aborted) return;
				onload(source);
				title = parsed.title;
				blocks = parsed.blocks;
				loaded = true;
				status =
					'Run chunks in order, or run the whole worksheet. Edits last until you leave this view.';
			} catch (error) {
				if (!abort.signal.aborted) status = String(error);
			}
		})();
		return () => {
			abort.abort();
			generation++;
			runtime?.close();
		};
	});

	function reset() {
		generation++;
		runtime?.close();
		runtime = undefined;
		runtimeReady = false;
		busy = false;
		for (const block of blocks) {
			block.output = '';
			block.plots = [];
			block.done = false;
		}
		status = 'R session reset. Run the worksheet to start again.';
	}

	async function start(ticket: number) {
		if (runtime) return runtime;
		status = 'Loading R… The first run downloads the runtime.';
		const { WebR, ChannelType } = await import('webr');
		if (ticket !== generation) throw new Error('Session reset');
		const r = new WebR({
			baseUrl: 'https://webr.r-wasm.org/v0.5.8/',
			channelType: ChannelType.PostMessage
		});
		runtime = r;
		await r.init();
		await r.evalRVoid('options(max.print=1000)');
		if (blocks.some((b) => b.kind === 'r' && /\bknitr::/.test(b.code))) {
			status = 'Loading knitr…';
			await r.installPackages(['knitr']);
		}
		const directory = path.split('/').slice(0, -1).join('/');
		for (const file of files.filter(
			(f) =>
				!f.locked &&
				f.download &&
				/\.(csv|tsv|txt|rds|rda|rdata)$/i.test(f.path) &&
				f.path.split('/').slice(0, -1).join('/') === directory
		)) {
			const response = await fetch(file.download!, { signal: abort.signal });
			if (!response.ok) throw new Error(`Could not load ${file.path} (${response.status})`);
			await r.FS.writeFile(
				`/home/web_user/${file.path.split('/').at(-1)}`,
				new Uint8Array(await response.arrayBuffer())
			);
		}
		runtimeReady = true;
		return r;
	}

	async function run(selected?: Block) {
		if (busy) return;
		busy = true;
		const ticket = generation;
		try {
			const r = await start(ticket);
			if (ticket !== generation) return;
			const shelter = await new r.Shelter();
			try {
				for (const block of selected ? [selected] : blocks) {
					if (ticket !== generation) return;
					if (block.kind !== 'r' || (!selected && !block.evaluate)) continue;
					status = `Running ${block.label}…`;
					block.done = false;
					block.output = '';
					block.plots = [];
					const result = await shelter.captureR(block.code, {
						withAutoprint: true,
						captureGraphics: true
					});
					try {
						if (ticket !== generation) return;
						block.output = result.output
							.map((o) =>
								typeof o.data === 'string' ? o.data : (o.data?.message ?? String(o.data))
							)
							.join('\n');
						block.plots = result.images.map((image) => {
							const canvas = document.createElement('canvas');
							canvas.width = image.width;
							canvas.height = image.height;
							canvas.getContext('2d')!.drawImage(image, 0, 0);
							return canvas.toDataURL();
						});
						block.done = true;
						if (result.output.some((o) => o.type === 'error'))
							throw new Error(`${block.label} failed. Fix the code and run it again.`);
					} finally {
						result.images.forEach((image) => image.close());
					}
					await shelter.purge();
				}
				status = 'Finished. R runs locally in your browser.';
			} finally {
				if (ticket === generation) await shelter.purge();
			}
		} catch (error) {
			if (ticket === generation) {
				status = String(error);
				if (!runtimeReady) {
					runtime?.close();
					runtime = undefined;
				}
			}
		} finally {
			if (ticket === generation) busy = false;
		}
	}
</script>

<div class="h-full overflow-auto p-4 sm:p-6">
	<div class="mx-auto max-w-3xl">
		<div class="mb-5 flex flex-wrap gap-2">
			<button class={button} disabled={!loaded || busy} onclick={() => run()}>Run all</button>
			<button class={button} disabled={!loaded} onclick={reset}
				>{busy ? 'Stop and reset' : 'Reset session'}</button
			>
		</div>
		<p class="mb-6 text-sm text-muted" role="status">{status}</p>
		<h1 class="mb-6 text-2xl font-semibold">{title}</h1>
		{#each blocks as block, index}
			{#if block.kind === 'markdown'}
				<div class="prose max-w-none dark:prose-invert">{@html block.html}</div>
			{:else}
				<section class="my-5 min-w-0 rounded border border-border" aria-label={block.label}>
					<details open={block.show}>
						<summary class="cursor-pointer px-3 py-2 text-xs text-muted"
							>{block.label}{!block.evaluate ? ' · skipped by Run all' : ''}</summary
						>
						<textarea
							class="block w-full resize-y bg-surface p-3 font-mono text-sm"
							aria-label={`R code ${index}`}
							bind:value={block.code}
							rows={Math.min(18, Math.max(3, block.code.split('\n').length))}
							spellcheck="false"
							disabled={busy}
						></textarea>
					</details>
					<div class="flex items-center gap-3 px-3 py-2">
						<button class={button} disabled={busy} onclick={() => run(block)}>Run chunk</button>
						{#if block.done}<span class="text-xs text-muted">Done</span>{/if}
					</div>
					{#if block.output}<pre
							class="max-h-96 overflow-auto border-t border-border p-3 text-xs">{block.output}</pre>{/if}
					{#each block.plots ?? [] as plot}<img
							class="w-full bg-white"
							src={plot}
							alt={`R plot from ${block.label}`}
						/>{/each}
				</section>
			{/if}
		{/each}
	</div>
</div>
