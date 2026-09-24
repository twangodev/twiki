import { error, type RequestEvent } from '@sveltejs/kit';
import { createAuth, type AuthEnv } from '../../../worker/auth';
import { isOwner } from '../../../worker/access';
import { and, eq, inArray } from 'drizzle-orm';
import { database } from '../../../database';
import { account, session, siteAccess } from '../../../database/schema';

export async function requireOwner(event: RequestEvent) {
	const env = event.platform?.env;
	if (!env) error(503, 'Authentication unavailable');
	const session = await createAuth(env).api.getSession({ headers: event.request.headers });
	if (!session || !(await isOwner(env.DB, session.user.id, env.OWNER_GITHUB_ID))) {
		error(403, 'Only the site owner can manage access.');
	}
	return env;
}

export async function revokeAccess(env: AuthEnv, githubId: string) {
	if (githubId === env.OWNER_GITHUB_ID) error(400, 'Owner access cannot be revoked.');
	const db = database(env.DB);
	await db.batch([
		db.delete(siteAccess).where(eq(siteAccess.githubId, githubId)),
		db.delete(session).where(
			inArray(
				session.userId,
				db
					.select({ userId: account.userId })
					.from(account)
					.where(and(eq(account.providerId, 'github'), eq(account.accountId, githubId)))
			)
		)
	]);
}
