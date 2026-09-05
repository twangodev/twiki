import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { getPlatformProxy } from 'wrangler';
import { betterAuth } from 'better-auth';
import { testUtils } from 'better-auth/plugins';
import { createAuth, type AuthEnv } from '../worker/auth';
import { database } from '../database';
import { siteAccess } from '../database/schema';

const directory = mkdtempSync(join(tmpdir(), 'wisconsin-auth-e2e-'));
const configPath = join(directory, 'wrangler.json');
const persistPath = join(directory, 'state');
const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
const origin = 'http://127.0.0.1:4174';
writeFileSync(
	configPath,
	JSON.stringify({
		...config,
		main: resolve(config.main),
		assets: { ...config.assets, directory: resolve(config.assets.directory) },
		vars: {
			...config.vars,
			ORIGIN: origin,
			GITHUB_CLIENT_ID: 'test',
			GITHUB_CLIENT_SECRET: 'test',
			BETTER_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID()
		},
		routes: [],
		d1_databases: config.d1_databases.map((db: Record<string, unknown>) => ({
			...db,
			migrations_dir: resolve('migrations')
		}))
	})
);

const proxy = await getPlatformProxy<AuthEnv>({
	configPath,
	persist: { path: join(persistPath, 'v3') },
	remoteBindings: false
});
try {
	const sql = readdirSync('migrations')
		.filter((file) => file.endsWith('.sql'))
		.sort()
		.map((file) => readFileSync(`migrations/${file}`, 'utf8'))
		.join('\n')
		.split(';')
		.map((s) => s.trim())
		.filter(Boolean);
	await proxy.env.DB.batch(sql.map((statement) => proxy.env.DB.prepare(statement)));
	const auth = betterAuth({ ...createAuth(proxy.env).options, plugins: [testUtils()] });
	const ctx = await auth.$context;
	const user = await ctx.test.saveUser(ctx.test.createUser());
	await ctx.internalAdapter.createAccount({
		userId: user.id,
		providerId: 'github',
		accountId: proxy.env.OWNER_GITHUB_ID,
		issuer: 'local:oauth:github'
	});
	const { cookies } = await ctx.test.login({ userId: user.id });
	mkdirSync('.generated', { recursive: true });
	writeFileSync('.generated/auth-state.json', JSON.stringify({ cookies, origins: [] }));
	const logoutSession = await ctx.test.login({ userId: user.id });
	writeFileSync(
		'.generated/logout-state.json',
		JSON.stringify({ cookies: logoutSession.cookies, origins: [] })
	);
	await database(proxy.env.DB)
		.insert(siteAccess)
		.values({ githubId: '123456', githubLogin: 'fixture-member', createdAt: Date.now() });
	const member = await ctx.test.saveUser(ctx.test.createUser());
	await ctx.internalAdapter.createAccount({
		userId: member.id,
		providerId: 'github',
		accountId: '123456',
		issuer: 'local:oauth:github'
	});
	const memberSession = await ctx.test.login({ userId: member.id });
	writeFileSync(
		'.generated/member-state.json',
		JSON.stringify({ cookies: memberSession.cookies, origins: [] })
	);
} finally {
	await proxy.dispose();
}

const server = spawn(
	'bunx',
	[
		'wrangler',
		'dev',
		'--config',
		configPath,
		'--persist-to',
		persistPath,
		'--port',
		'4174',
		'--ip',
		'127.0.0.1',
		'--local'
	],
	{
		stdio: 'inherit',
		env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' }
	}
);
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => server.kill(signal));
try {
	process.exitCode = await new Promise<number>((resolve, reject) => {
		server.on('error', reject);
		server.on('exit', (code) => resolve(code ?? 0));
	});
} finally {
	rmSync(directory, { recursive: true, force: true });
}
