import { building, dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import {
	assetContentProvider,
	emptyContentProvider,
	localContentProvider
} from './content-provider';

export function requestContent(platform: App.Platform | undefined) {
	if (building && import.meta.env.VITE_STATIC_EXPORT !== 'true') return emptyContentProvider();
	if (dev || building)
		return localContentProvider(
			process.cwd(),
			import.meta.env.VITE_PUBLIC_EDITION === 'true' ? 'public' : 'full'
		);
	if (!platform) error(503, 'Content unavailable');
	try {
		const content = assetContentProvider(platform);
		const available = <T>(read: Promise<T>): Promise<T> =>
			read.catch(() => {
				error(503, 'Content unavailable');
			});
		return {
			context: content.context,
			manifest: () => available(content.manifest()),
			page: (slug: string) => available(content.page(slug)),
			nav: () => available(content.nav()),
			icons: () => available(content.icons()),
			model: () => available(content.model())
		};
	} catch {
		error(503, 'Content unavailable');
	}
}
