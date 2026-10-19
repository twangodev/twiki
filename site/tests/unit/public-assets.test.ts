import { expect, test } from 'bun:test';
import { publicResponse } from '../../worker/publication';

test('public responses remain indexable without caching cookies or personalized variants', async () => {
	const response = publicResponse(
		new Response('published', {
			headers: { 'Set-Cookie': 'session=private', 'X-Robots-Tag': 'noindex' }
		}),
		new Request('https://example.com/note')
	);
	expect(response.headers.get('set-cookie')).toBeNull();
	expect(response.headers.get('x-robots-tag')).toBeNull();
	expect(response.headers.get('cache-control')).toBe('no-store');
	expect(response.headers.get('vary')).toBe('Cookie');
	expect(await response.text()).toBe('published');
	const head = publicResponse(
		new Response('published'),
		new Request('https://example.com/note', { method: 'HEAD' })
	);
	expect(await head.text()).toBe('');
});
