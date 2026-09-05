import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import type { D1Database } from '@cloudflare/workers-types';

export interface AuthEnv {
	DB: D1Database;
	ORIGIN: string;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	BETTER_AUTH_SECRET: string;
	OWNER_GITHUB_ID: string;
}

export async function isOwner(db: D1Database, userId: string, ownerId: string) {
	return Boolean(
		await db
			.prepare('SELECT id FROM account WHERE userId = ? AND providerId = ? AND accountId = ?')
			.bind(userId, 'github', ownerId)
			.first()
	);
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
				mapProfileToUser(profile) {
					if (String(profile.id) !== env.OWNER_GITHUB_ID) {
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
						account.providerId === 'github' && account.accountId === env.OWNER_GITHUB_ID
				}
			},
			session: {
				create: { before: async (session) => isOwner(env.DB, session.userId, env.OWNER_GITHUB_ID) }
			}
		}
	});
}
