import { expect, test } from 'bun:test';
import type { RequestEvent } from '@sveltejs/kit';
import { handle } from '../../src/hooks.server';

const shell = '<html><body><div></div></body></html>';

async function render(route: string | null, html = shell) {
	return handle({
		event: { route: { id: route } } as RequestEvent,
		resolve: async (_event, options) =>
			new Response((await options?.transformPageChunk?.({ html, done: true })) ?? html)
	});
}

test('the SSR-disabled file-browser HTML includes its no-JavaScript notice', async () => {
	const response = await render('/[course]/files/[...file]');
	expect(await response.text()).toBe(
		'<html><body><div></div><noscript><p>Enable JavaScript to use the file browser.</p></noscript></body></html>'
	);
});

test('notes and unmatched routes retain their readable HTML without a file-browser notice', async () => {
	for (const route of ['/[...slug]', '/tags/[...tag]', '/files', null]) {
		const response = await render(route);
		expect(await response.text()).toBe(shell);
	}
});
