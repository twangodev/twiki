import type { PageServerLoad } from './$types';
import { tagIndex } from '$lib/server/content';

export const load: PageServerLoad = () => {
	return { tags: tagIndex() };
};
