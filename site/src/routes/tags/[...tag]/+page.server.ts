import { error } from '@sveltejs/kit';
import type { EntryGenerator, PageServerLoad } from './$types';
import { requestContent } from '$lib/server/runtime-content';
export const entries: EntryGenerator = async () => {
	if (import.meta.env.VITE_STATIC_EXPORT !== 'true') return [];
	return Object.keys((await requestContent(undefined).manifest()).tags).map((tag) => ({ tag }));
};
export const load: PageServerLoad = async ({ params, platform }) => {
	const model = await requestContent(platform).model();
	const pages = model.tagPages(params.tag);
	if (!pages) error(404, 'Tag not found');
	return {
		tag: params.tag,
		pages: pages.map((p) => ({
			route: `/${model.displayRoute(p.slug)}`,
			title: p.title,
			description: p.description,
			modified: p.dates.modified,
			tags: p.tags
		}))
	};
};
