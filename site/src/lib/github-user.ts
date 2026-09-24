export const githubUsername = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
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
				'X-GitHub-Api-Version': '2026-03-10'
			},
			credentials: 'omit',
			redirect: 'error',
			signal: AbortSignal.timeout(5000)
		});
		if (response.status === 404)
			return { status: 404, error: 'That GitHub account was not found.' };
		if (!response.ok) {
			console.warn('GitHub user lookup rejected', {
				status: response.status,
				requestId: response.headers.get('x-github-request-id'),
				rateLimitRemaining: response.headers.get('x-ratelimit-remaining'),
				rateLimitReset: response.headers.get('x-ratelimit-reset'),
				retryAfter: response.headers.get('retry-after')
			});
			const rateLimited =
				response.status === 429 ||
				(response.status === 403 &&
					(response.headers.get('x-ratelimit-remaining') === '0' ||
						response.headers.has('retry-after')));
			return {
				status: 503,
				error: rateLimited
					? 'GitHub has temporarily rate-limited account lookups. Please try again later.'
					: `GitHub lookup failed (HTTP ${response.status}). Please try again later.`
			};
		}
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
	} catch (cause) {
		const kind = cause instanceof Error ? cause.name : 'UnknownError';
		console.warn('GitHub user lookup failed', { kind });
		return {
			status: 503,
			error:
				kind === 'TimeoutError' || kind === 'AbortError'
					? 'GitHub lookup timed out. Please try again.'
					: kind === 'SyntaxError'
						? 'GitHub returned an unreadable response. Please try again later.'
						: 'Could not connect to GitHub for account lookup. Please try again later.'
		};
	}
}
