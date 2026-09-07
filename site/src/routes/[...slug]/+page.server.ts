import { error } from '@sveltejs/kit';
import type { EntryGenerator, PageServerLoad } from './$types';
import { contentEntries, folderListing, loadPage, pageSlugForRoute } from '$lib/server/content';
import type { TocEntry } from '$lib/types';

/** Every page display route ('' = home) plus every generated folder listing. */
export const entries: EntryGenerator = () => contentEntries().map((slug) => ({ slug }));

export const load: PageServerLoad = ({ params }) => {
	const route = params.slug.replace(/^\/+|\/+$/g, '');

	const slug = pageSlugForRoute(route);
	if (slug) {
		const { markdown: _markdown, ...page } = loadPage(slug);
		// Normalize the build-time TOC for the right-hand rail (depth is 0-based).
		const toc: TocEntry[] = page.toc.map((t) => ({
			id: t.slug,
			text: t.text,
			level: t.depth + 1
		}));
		return { kind: 'page' as const, route, page, toc };
	}

	const listing = folderListing(route);
	if (listing) {
		return { kind: 'folder' as const, route, listing, toc: [] as TocEntry[] };
	}

	error(404, 'Page not found');
};
