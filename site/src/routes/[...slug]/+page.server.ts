import { error } from '@sveltejs/kit';
import type { EntryGenerator, PageServerLoad } from './$types';
import { requestContent } from '$lib/server/runtime-content';
import type { TocEntry } from '$lib/types';

export const entries: EntryGenerator = async () => {
	if (import.meta.env.VITE_STATIC_EXPORT !== 'true') return [];
	return (await requestContent(undefined).model()).contentEntries().map((slug) => ({ slug }));
};

export const load: PageServerLoad = async ({ params, platform }) => {
	const route = params.slug.replace(/^\/+|\/+$/g, '');
	const content = requestContent(platform);
	const model = await content.model();
	const slug = model.pageSlugForRoute(route);
	if (slug) {
		const { markdown: _markdown, ...page } = await content.page(slug);
		const toc: TocEntry[] = page.toc.map((t) => ({ id: t.slug, text: t.text, level: t.depth + 1 }));
		return { kind: 'page' as const, route, page, toc };
	}
	const listing = model.folderListing(route);
	if (listing) return { kind: 'folder' as const, route, listing, toc: [] as TocEntry[] };
	error(404, 'Page not found');
};
