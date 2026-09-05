import { error, type RequestEvent } from '@sveltejs/kit';
import { createAuth, type AuthEnv } from '../../../worker/auth';
import { isOwner } from '../../../worker/access';

export interface AccessGrant {
	githubId: string;
	githubLogin: string;
	createdAt: number;
}

export async function requireOwner(event: RequestEvent) {
	const env = event.platform?.env;
	if (!env) error(503, 'Authentication unavailable');
	const session = await createAuth(env).api.getSession({ headers: event.request.headers });
	if (!session || !(await isOwner(env.DB, session.user.id, env.OWNER_GITHUB_ID))) {
		error(403, 'Only the site owner can manage access.');
	}
	return env;
}

const githubUsername = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
type Lookup = { user: { id: string; login: string } } | { status: number; error: string };

export async function lookupGithubUser(
	value: FormDataEntryValue | null,
	fetcher = fetch
): Promise<Lookup> {
	const username = typeof value === 'string' ? value.trim().replace(/^@/, '') : '';
	if (!githubUsername.test(username))
		return { status: 400, error: 'Enter a valid GitHub username.' };
	try {
		const response = await fetcher(`https://api.github.com/users/${encodeURIComponent(username)}`, {
			headers: {
				Accept: 'application/vnd.github+json',
				'User-Agent': 'wisconsin',
				'X-GitHub-Api-Version': '2026-03-10'
			},
			redirect: 'error',
			signal: AbortSignal.timeout(5000)
		});
		if (response.status === 404)
			return { status: 404, error: 'That GitHub account was not found.' };
		if (!response.ok)
			return { status: 503, error: 'GitHub lookup is unavailable. Please try again later.' };
		const profile = (await response.json()) as { id?: number; login?: string; type?: string };
		if (
			!Number.isSafeInteger(profile.id) ||
			profile.id! <= 0 ||
			typeof profile.login !== 'string' ||
			!githubUsername.test(profile.login) ||
			profile.type !== 'User'
		) {
			return {
				status: 400,
				error: 'Choose a personal GitHub account, not an organization or bot.'
			};
		}
		return { user: { id: String(profile.id), login: profile.login } };
	} catch {
		return { status: 503, error: 'GitHub lookup is unavailable. Please try again later.' };
	}
}

export async function revokeAccess(env: AuthEnv, githubId: string) {
	if (githubId === env.OWNER_GITHUB_ID) error(400, 'Owner access cannot be revoked.');
	await env.DB.batch([
		env.DB.prepare('DELETE FROM siteAccess WHERE githubId = ?').bind(githubId),
		env.DB.prepare(
			`DELETE FROM session WHERE userId IN (
			SELECT userId FROM account WHERE providerId = 'github' AND accountId = ?
		)`
		).bind(githubId)
	]);
}
