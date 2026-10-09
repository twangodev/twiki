import type { LayoutServerLoad } from './$types';
import { requestContent } from '$lib/server/runtime-content';

export const load: LayoutServerLoad = async ({ platform, url }) => {
	// Track navigation so a stable application build still refreshes content data.
	void url.pathname;
	const content = requestContent(platform);
	const [nav, fileIcons] = await Promise.all([content.nav(), content.icons()]);
	return { nav, fileIcons, edition: content.context.edition };
};
