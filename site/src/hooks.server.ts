import type { Handle } from '@sveltejs/kit';

const fileBrowserNotice = '<noscript><p>Enable JavaScript to use the file browser.</p></noscript>';

export const handle: Handle = ({ event, resolve }) => {
	if (event.route.id !== '/[course]/files/[...file]') return resolve(event);
	// The file browser disables SSR for the whole component tree. Transform its
	// actual HTML shell so the notice also exists before client startup.
	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('</body>', `${fileBrowserNotice}</body>`)
	});
};
