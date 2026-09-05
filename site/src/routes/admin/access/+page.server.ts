import { fail } from '@sveltejs/kit';
import {
	lookupGithubUser,
	requireOwner,
	revokeAccess,
	type AccessGrant
} from '$lib/server/access-admin';
import type { Actions, PageServerLoad } from './$types';

export const prerender = false;

export const load: PageServerLoad = async (event) => {
	const env = await requireOwner(event);
	const { results } = await env.DB.prepare(
		'SELECT * FROM siteAccess ORDER BY githubLogin COLLATE NOCASE'
	).all<AccessGrant>();
	return { grants: results, ownerId: env.OWNER_GITHUB_ID };
};

export const actions: Actions = {
	add: async (event) => {
		const env = await requireOwner(event);
		const form = await event.request.formData();
		const result = await lookupGithubUser(form.get('username'), event.fetch);
		if ('error' in result) return fail(result.status, { error: result.error });
		const { id, login } = result.user;
		if (id === env.OWNER_GITHUB_ID)
			return fail(400, { error: 'You already have permanent owner access.' });
		await env.DB.prepare(
			`INSERT INTO siteAccess (githubId, githubLogin, createdAt) VALUES (?, ?, ?)
			ON CONFLICT(githubId) DO UPDATE SET githubLogin = excluded.githubLogin`
		)
			.bind(id, login, Date.now())
			.run();
		return { message: `@${login} can now sign in and read all courses.` };
	},
	revoke: async (event) => {
		const env = await requireOwner(event);
		const id = (await event.request.formData()).get('githubId');
		if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id))
			return fail(400, { error: 'Invalid GitHub account ID.' });
		if (id === env.OWNER_GITHUB_ID) return fail(400, { error: 'Owner access cannot be revoked.' });
		await revokeAccess(env, id);
		return { message: 'Access revoked. Existing sessions have been signed out.' };
	}
};
