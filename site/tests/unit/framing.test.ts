import { expect, test } from 'bun:test';
import { frameOptions } from '../../worker/framing';
import { publicResponse } from '../../worker/publication';

test('only successful PDF responses permit same-origin framing', () => {
	for (const [status, contentType, expected] of [
		[200, 'application/pdf', 'SAMEORIGIN'],
		[206, 'application/pdf', 'SAMEORIGIN'],
		[200, 'Application/PDF; charset=binary', 'SAMEORIGIN'],
		[200, 'text/html', 'DENY'],
		[200, 'application/octet-stream', 'DENY'],
		[302, 'application/pdf', 'DENY'],
		[401, 'application/pdf', 'DENY'],
		[404, 'text/html', 'DENY']
	] as const) {
		const response = new Response(null, { status, headers: { 'Content-Type': contentType } });
		expect(frameOptions(response)).toBe(expected);
		for (const path of ['/course/assets/notes.pdf', '/_files/blobs/notes.pdf', '/not-a-pdf']) {
			expect(
				publicResponse(response, new Request(`https://example.com${path}`)).headers.get(
					'X-Frame-Options'
				)
			).toBe(expected);
		}
	}
	expect(frameOptions(new Response(null))).toBe('DENY');
});
