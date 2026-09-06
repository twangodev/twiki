import { expect, test } from 'bun:test';
import { lookupGithubUser } from '../../src/lib/server/access-admin';

test('GitHub lookup normalizes usernames and stores the stable account ID', async () => {
	const result = await lookupGithubUser(' @Example ', (async (url, init) => {
		expect(url).toBe('https://api.github.com/users/Example');
		expect(init?.redirect).toBe('error');
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
