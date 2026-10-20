import type { PageServerLoad } from './$types';
import { requestContent } from '$lib/server/runtime-content';
export const load: PageServerLoad = async ({ platform, depends }) => {
	depends('twiki:content');
	return { tags: (await requestContent(platform).model()).tagIndex() };
};
