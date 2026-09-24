import rybbit from '@rybbit/js';

function hasOptedOut() {
	if ((window as Window & { __RYBBIT_OPTOUT__?: boolean }).__RYBBIT_OPTOUT__) return true;
	try {
		return localStorage.getItem('disable-rybbit') !== null;
	} catch {
		return false;
	}
}

export async function initializeAnalytics() {
	// SDK 0.6.2 checks opt-out for events, but not identify requests.
	if (hasOptedOut()) return;

	// Resolve the current login before init schedules its initial pageview.
	let username: string | null = null;
	try {
		const response = await fetch('/api/access', {
			cache: 'no-store',
			signal: AbortSignal.timeout(5000)
		});
		if (response.ok) {
			const access = await response.json();
			if (typeof access.githubUsername === 'string' && access.githubUsername.trim())
				username = access.githubUsername;
		}
	} catch {
		// Do not reuse a previous user's identity when the session cannot be checked.
	}

	await rybbit.init({ analyticsHost: 'https://rybbit.twango.dev/api', siteId: '4' });
	if (username) rybbit.identify(username);
	else rybbit.clearUserId();
}
