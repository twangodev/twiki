import { githubUsername } from '$lib/github-user';
import { fail } from '@sveltejs/kit';
import { requireOwner, revokeAccess } from '$lib/server/access-admin';
import type { Actions, PageServerLoad } from './$types';
import { sql } from 'drizzle-orm';
import { database } from '../../../../database';
import { siteAccess } from '../../../../database/schema';

export const prerender = false;

export const load: PageServerLoad = async (event) => {
	const env = await requireOwner(event);
	const grants = await database(env.DB)
		.select()
		.from(siteAccess)
		.orderBy(sql`${siteAccess.githubLogin} COLLATE NOCASE`);
	return { grants, ownerId: env.OWNER_GITHUB_ID };
};

export const actions: Actions = {
	add: async (event) => {
		const env = await requireOwner(event);
		const form = await event.request.formData();
		// The authenticated owner may grant any GitHub ID. The browser resolves the
		// profile; the ID controls access and the login is only a display label.
		const id = form.get('githubId');
		const login = form.get('githubLogin');
		if (
			typeof id !== 'string' ||
			!/^[1-9]\d*$/.test(id) ||
			!Number.isSafeInteger(Number(id)) ||
			typeof login !== 'string' ||
			!githubUsername.test(login)
		)
			return fail(400, { error: 'Resolve a valid GitHub account before adding access.' });
		if (id === env.OWNER_GITHUB_ID)
			return fail(400, { error: 'You already have permanent owner access.' });
		await database(env.DB)
			.insert(siteAccess)
			.values({ githubId: id, githubLogin: login, createdAt: Date.now() })
			.onConflictDoUpdate({ target: siteAccess.githubId, set: { githubLogin: login } });
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
