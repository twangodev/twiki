import type { LayoutServerLoad } from './$types';
import { dev } from '$app/environment';
import { requestContent } from '$lib/server/runtime-content';

export const load: LayoutServerLoad = async ({ platform, url }) => {
	// Dev content updates invalidate all data. Production navigation must still
	// refresh independently published content without rebuilding the application.
	if (!dev) void url.pathname;
	const content = requestContent(platform);
	const [nav, fileIcons] = await Promise.all([content.nav(), content.icons()]);
	return {
		nav,
		fileIcons,
		edition: content.context.edition,
		contentVersion: `${content.context.snapshot}:${content.context.applicationVersion}`
	};
};
