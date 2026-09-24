import { expect, spyOn, test } from 'bun:test';
import { lookupGithubUser } from '../../src/lib/github-user';

test('GitHub lookup normalizes usernames and stores the stable account ID', async () => {
	const result = await lookupGithubUser(' @Example ', (async (url, init) => {
		expect(url).toBe('https://api.github.com/users/Example');
		expect(init?.redirect).toBe('error');
		expect(init?.credentials).toBe('omit');
		expect(new Headers(init?.headers).has('User-Agent')).toBe(false);
		return Response.json({ id: 123, login: 'example', type: 'User' });
	}) as typeof fetch);
	expect(result).toEqual({ user: { id: '123', login: 'example' } });
});

test('invalid usernames never trigger a lookup', async () => {
	for (const value of [
		null,
		'',
		'../users/foo',
		'https://github.com/foo',
		'-foo',
		'a'.repeat(40)
	]) {
		const result = await lookupGithubUser(value, (() => {
			throw new Error('unexpected fetch');
		}) as unknown as typeof fetch);
		expect(result).toHaveProperty('status', 400);
	}
});

test('GitHub failures and non-personal accounts are rejected', async () => {
	for (const [response, status] of [
		[new Response(null, { status: 404 }), 404],
		[new Response(null, { status: 403 }), 503],
		[Response.json({ id: 123, login: 'example', type: 'Organization' }), 400],
		[Response.json({ id: -1, login: 'example', type: 'User' }), 400],
		[new Response('invalid json'), 503]
	] as const) {
		expect(
			await lookupGithubUser('example', (async () => response) as unknown as typeof fetch)
		).toHaveProperty('status', status);
	}
});

test('lookup distinguishes rate limits from other GitHub failures', async () => {
	const warning = spyOn(console, 'warn').mockImplementation(() => {});
	try {
		for (const [status, headers, message] of [
			[403, { 'x-ratelimit-remaining': '0' }, 'rate-limited'],
			[403, { 'retry-after': '60' }, 'rate-limited'],
			[429, {}, 'rate-limited'],
			[403, {}, 'HTTP 403'],
			[500, {}, 'HTTP 500']
		] as const) {
			const result = await lookupGithubUser(
				'example',
				(async () => new Response(null, { status, headers })) as unknown as typeof fetch
			);
			expect(result).toHaveProperty('status', 503);
			expect('error' in result && result.error).toContain(message);
		}
	} finally {
		warning.mockRestore();
	}
});

test('lookup distinguishes timeouts, network errors, and unreadable responses', async () => {
	const warning = spyOn(console, 'warn').mockImplementation(() => {});
	try {
		for (const [cause, message] of [
			[new DOMException('timed out', 'TimeoutError'), 'timed out'],
			[new TypeError('fetch failed'), 'Could not connect'],
			[new SyntaxError('invalid JSON'), 'unreadable response']
		] as const) {
			const result = await lookupGithubUser('example', (async () => {
				throw cause;
			}) as unknown as typeof fetch);
			expect(result).toHaveProperty('status', 503);
			expect('error' in result && result.error).toContain(message);
			expect(warning).toHaveBeenLastCalledWith('GitHub user lookup failed', {
				kind: cause.name
			});
		}
	} finally {
		warning.mockRestore();
	}
});
