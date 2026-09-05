import type { AuthEnv } from './auth';
import type { D1Database } from '@cloudflare/workers-types';

export async function isOwner(db: D1Database, userId: string, ownerId: string) {
	return Boolean(
		await db
			.prepare('SELECT id FROM account WHERE userId = ? AND providerId = ? AND accountId = ?')
			.bind(userId, 'github', ownerId)
			.first()
	);
}

export async function isGithubAllowed(env: AuthEnv, githubId: string) {
	return (
		githubId === env.OWNER_GITHUB_ID ||
		Boolean(
			await env.DB.prepare('SELECT githubId FROM siteAccess WHERE githubId = ?')
				.bind(githubId)
				.first()
		)
	);
}

export async function accessForUser(
	env: AuthEnv,
	userId: string
): Promise<'owner' | 'member' | null> {
	const account = await env.DB.prepare(
		`
		SELECT account.accountId FROM account
		LEFT JOIN siteAccess ON siteAccess.githubId = account.accountId
		WHERE account.userId = ? AND account.providerId = 'github'
		AND (account.accountId = ? OR siteAccess.githubId IS NOT NULL)
		ORDER BY account.accountId = ? DESC LIMIT 1
	`
	)
		.bind(userId, env.OWNER_GITHUB_ID, env.OWNER_GITHUB_ID)
		.first<{ accountId: string }>();
	if (!account) return null;
	return account.accountId === env.OWNER_GITHUB_ID ? 'owner' : 'member';
}
