import { and, desc, eq, isNotNull, or } from 'drizzle-orm';
import { database } from '../database';
import { account, siteAccess } from '../database/schema';
import type { AuthEnv } from './auth';
import type { D1Database } from '@cloudflare/workers-types';

export async function isOwner(binding: D1Database, userId: string, ownerId: string) {
	return Boolean(
		await database(binding)
			.select({ id: account.id })
			.from(account)
			.where(
				and(
					eq(account.userId, userId),
					eq(account.providerId, 'github'),
					eq(account.accountId, ownerId)
				)
			)
			.get()
	);
}

export async function isGithubAllowed(env: AuthEnv, githubId: string) {
	return (
		githubId === env.OWNER_GITHUB_ID ||
		Boolean(
			await database(env.DB)
				.select({ id: siteAccess.githubId })
				.from(siteAccess)
				.where(eq(siteAccess.githubId, githubId))
				.get()
		)
	);
}

export async function accessForUser(
	env: AuthEnv,
	userId: string
): Promise<'owner' | 'member' | null> {
	const owner = eq(account.accountId, env.OWNER_GITHUB_ID);
	const match = await database(env.DB)
		.select({ accountId: account.accountId })
		.from(account)
		.leftJoin(siteAccess, eq(siteAccess.githubId, account.accountId))
		.where(
			and(
				eq(account.userId, userId),
				eq(account.providerId, 'github'),
				or(owner, isNotNull(siteAccess.githubId))
			)
		)
		.orderBy(desc(owner))
		.limit(1)
		.get();
	if (!match) return null;
	return match.accountId === env.OWNER_GITHUB_ID ? 'owner' : 'member';
}
