import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import type { D1Database } from '@cloudflare/workers-types';
import { accessForUser, isGithubAllowed } from './access';
export { isOwner } from './access';

export interface AuthEnv {
	DB: D1Database;
	ORIGIN: string;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	BETTER_AUTH_SECRET: string;
	OWNER_GITHUB_ID: string;
}

export function createAuth(env: AuthEnv) {
	if (
		!env.DB ||
		!env.ORIGIN ||
		!env.GITHUB_CLIENT_ID ||
		!env.GITHUB_CLIENT_SECRET ||
		!env.BETTER_AUTH_SECRET ||
		env.BETTER_AUTH_SECRET.length < 32 ||
		!/^\d+$/.test(env.OWNER_GITHUB_ID ?? '')
	) {
		throw new Error('Authentication configuration is incomplete');
	}
	return betterAuth({
		appName: 'Wisconsin',
		baseURL: env.ORIGIN,
		secret: env.BETTER_AUTH_SECRET,
		database: env.DB,
		trustedOrigins: [env.ORIGIN],
		emailAndPassword: { enabled: false },
		account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
		session: { cookieCache: { enabled: false }, expiresIn: 60 * 60 * 24 * 7 },
		rateLimit: { enabled: true, storage: 'database' },
		advanced: {
			useSecureCookies: new URL(env.ORIGIN).protocol === 'https:',
			ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] }
		},
		socialProviders: {
			github: {
				clientId: env.GITHUB_CLIENT_ID,
				clientSecret: env.GITHUB_CLIENT_SECRET,
				async mapProfileToUser(profile) {
					if (!(await isGithubAllowed(env, String(profile.id)))) {
						throw new APIError('FORBIDDEN', { message: 'This account does not have access.' });
					}
					return {};
				}
			}
		},
		databaseHooks: {
			account: {
				create: {
					before: async (account) =>
						account.providerId === 'github' && (await isGithubAllowed(env, account.accountId))
				}
			},
			session: {
				create: { before: async (session) => Boolean(await accessForUser(env, session.userId)) }
			}
		}
	});
}
