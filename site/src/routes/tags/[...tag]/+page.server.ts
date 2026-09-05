import { error } from '@sveltejs/kit';
import type { EntryGenerator, PageServerLoad } from './$types';
import { displayRoute, getManifest, tagPages } from '$lib/server/content';

/** One prerendered page per tag — tag slugs are case-sensitive (e.g. /tags/ELF). */
export const entries: EntryGenerator = () =>
	Object.keys(getManifest().tags).map((tag) => ({ tag }));

export const load: PageServerLoad = ({ params }) => {
	const pages = tagPages(params.tag);
	if (!pages) error(404, 'Tag not found');
	return {
		tag: params.tag,
		pages: pages.map((p) => ({
			route: `/${displayRoute(p.slug)}`,
			title: p.title,
			description: p.description,
			modified: p.dates.modified,
			tags: p.tags
		}))
	};
};
