<script lang="ts">
	// Temporary Phase 0 page: renders the transplanted doc shell with stub nav
	// data so the visual identity is inspectable. Replaced by the manifest-driven
	// catch-all route in later phases.
	import DocShell from '$lib/components/doc/DocShell.svelte';
	import type { NavNode } from '$lib/types';

	// Route-less section nodes: real routes arrive with the manifest, and the
	// strict prerender crawler (kept on purpose as broken-link CI) would fail on
	// fake hrefs today.
	const stubNav: NavNode[] = [
		{ title: 'Home', route: '/', children: [], segment: 'index' },
		{
			title: 'sp26-cs537',
			segment: 'sp26-cs537',
			children: [
				{ title: 'README', children: [], segment: 'README' },
				{ title: 'p1', children: [], segment: 'p1' }
			]
		},
		{
			title: 'sp26-cs544',
			segment: 'sp26-cs544',
			children: [{ title: 'README', children: [], segment: 'README' }]
		},
		{ title: 'Tags', children: [], segment: 'tags' }
	];
</script>

<DocShell nav={stubNav}>
	<article class="prose dark:prose-invert">
		<h1>wisconsin</h1>
		<p>
			Phase 0 scaffold — cca's doc shell wearing <a href="/">wisconsin red</a>. Content pipeline
			lands in Phase 1.
		</p>
	</article>
</DocShell>
