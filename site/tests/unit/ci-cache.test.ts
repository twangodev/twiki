import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { compilerCacheFiles } from '../../tooling/lib/cache-selection';

test('engine CI keeps credentials out of tests and deploys only its demo after validation', () => {
	const raw = readFileSync('../.github/workflows/ci.yml', 'utf8');
	for (const schema of ['core', 'yaml-1.1'] as const) {
		const workflow = parse(raw, { schema }) as {
			permissions: Record<string, string>;
			jobs: Record<
				string,
				{
					environment?: unknown;
					needs?: string;
					if?: string;
					concurrency?: unknown;
					steps: {
						run?: string;
						uses?: string;
						env?: Record<string, string>;
						'working-directory'?: string;
						with?: Record<string, string>;
					}[];
				}
			>;
		};
		expect(workflow.permissions.contents).toBe('read');
		expect(Object.keys(workflow.jobs).length).toBeGreaterThan(0);
		expect(JSON.stringify(workflow.jobs.test)).not.toMatch(
			/CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|BUILD_CACHE_KEY|PAT_TOKEN/
		);
		for (const job of [workflow.jobs.test]) {
			expect(job.environment).toBeUndefined();
			for (const step of job.steps) {
				expect(step.run ?? '').not.toMatch(
					/wrangler\s+(?:deploy|rollback)|twiki\s+deploy|tooling\/deploy\.ts|migrations apply.*--remote/
				);
				if (step.uses?.startsWith('actions/cache'))
					expect(step.with?.path).toBe('~/.bun/install/cache');
			}
		}
		const deploy = workflow.jobs.deploy;
		expect(deploy.needs).toBe('test');
		expect(deploy.if).toContain("github.repository == 'twangodev/twiki'");
		expect(deploy.if).toContain("github.ref == 'refs/heads/main'");
		expect(deploy.if).toContain("github.event_name == 'push'");
		expect(deploy.if).toContain("github.event_name == 'workflow_dispatch'");
		expect(deploy.environment).toEqual({ name: 'production', url: 'https://twiki.twango.dev' });
		expect(deploy.concurrency).toEqual({ group: 'twiki-production', 'cancel-in-progress': false });
		const upload = deploy.steps.find((step) => step.env?.CLOUDFLARE_API_TOKEN);
		expect(upload?.['working-directory']).toBe('documentation');
		expect(upload?.run).toContain('bun ../cli/twiki.ts deploy');
		expect(deploy.steps.filter((step) => step.env?.CLOUDFLARE_API_TOKEN)).toHaveLength(1);
		expect(deploy.steps.some((step) => step.run?.includes('build --target'))).toBe(false);
		const download = deploy.steps.find((step) => step.uses?.startsWith('actions/download-artifact@'));
		expect(download?.with?.name).toBe('twiki-cloudflare');
		expect(download?.with?.['digest-mismatch']).toBe('error');
		expect(deploy.steps.at(-1)?.run).toContain('tooling/verify-deployment.ts');
	}
});

function cacheFixture(
	run: (fixture: {
		directory: string;
		key: string;
		execute: (mode: 'save' | 'restore', key?: string) => string;
	}) => void
) {
	const directory = mkdtempSync(path.join(tmpdir(), 'wisconsin-ci-cache-'));
	const key = randomBytes(32).toString('hex');
	const env = {
		...process.env,
		GITHUB_OUTPUT: path.join(directory, 'outputs'),
		TMPDIR: directory
	};
	mkdirSync(path.join(directory, 'build/generated/cache'), { recursive: true });
	try {
		run({
			directory,
			key,
			execute(mode, secret = key) {
				const result = spawnSync(process.execPath, [path.resolve('tooling/cache.ts'), mode], {
					cwd: directory,
					env: { ...env, BUILD_CACHE_KEY: secret },
					encoding: 'utf8',
					timeout: 15000
				});
				expect(result.status).toBe(0);
				return result.stdout;
			}
		});
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test('compiler transport encryption restores selected files and rejects wrong keys and tampering', () => {
	cacheFixture(({ directory, execute }) => {
		const cache = path.join(directory, 'build/generated/cache');
		const files = [
			`stage1/ab/${'a'.repeat(64)}.json`,
			`file-history/course/${'e'.repeat(64)}-blame.json`,
			'file-history/course/revisions-v1-head.jsonl',
			'gitdates-v3-course-version-head.json',
			`social-titles/${'b'.repeat(64)}.png`,
			'rmd/key/result.json'
		];
		for (const file of files) {
			mkdirSync(path.dirname(path.join(cache, file)), { recursive: true });
			writeFileSync(path.join(cache, file), 'private fixture content');
		}
		const historyOutput = path.join(directory, 'build/generated/assets/_files/history');
		mkdirSync(historyOutput, { recursive: true });
		writeFileSync(path.join(historyOutput, path.basename(files[1])), 'published history fixture');
		writeFileSync(path.join(cache, 'history-current.json'), JSON.stringify([files[1]]));
		writeFileSync(path.join(cache, 'stage1-current.json'), JSON.stringify([files[0]]));
		writeFileSync(
			path.join(cache, 'social-titles-current-public.json'),
			JSON.stringify([files[4]])
		);
		writeFileSync(path.join(cache, 'social-titles-current-full.json'), JSON.stringify([files[4]]));
		const staleParser = `stage1/ab/${'c'.repeat(64)}.json`;
		const staleSocial = `social-titles/${'d'.repeat(64)}.png`;
		const staleHistory = 'file-history/course/obsolete-blame.json';
		writeFileSync(path.join(cache, staleParser), 'stale cached parse');
		writeFileSync(path.join(cache, staleSocial), 'stale cached social card');
		writeFileSync(path.join(cache, staleHistory), 'stale cached history');
		writeFileSync(path.join(cache, 'credentials.env'), 'excluded fixture');
		execute('save');
		expect(existsSync(path.join(cache, staleParser))).toBe(true);
		expect(existsSync(path.join(cache, staleSocial))).toBe(true);
		expect(existsSync(path.join(cache, staleHistory))).toBe(true);
		expect(readFileSync(path.join(directory, 'outputs'), 'utf8')).toBe('ready=true\n');
		const archive = path.join(directory, 'build/generated/compiler-cache.gpg');
		const encrypted = readFileSync(archive);
		expect(encrypted.includes(Buffer.from('private fixture content'))).toBe(false);
		rmSync(cache, { recursive: true });
		rmSync(historyOutput, { recursive: true });
		expect(execute('restore', '')).toContain('BUILD_CACHE_KEY is missing');
		expect(existsSync(cache)).toBe(false);
		expect(execute('restore', 'wrong-key')).toContain('building cold');
		expect(existsSync(cache)).toBe(false);
		const tampered = Buffer.from(encrypted);
		tampered[tampered.length - 1] ^= 1;
		writeFileSync(archive, tampered);
		expect(execute('restore')).toContain('building cold');
		expect(existsSync(cache)).toBe(false);
		const unencrypted = spawnSync('gpg', ['--batch', '--yes', '--store', '--output', archive], {
			env: { ...process.env, GNUPGHOME: directory },
			input: 'unauthenticated cache'
		});
		expect(unencrypted.status).toBe(0);
		expect(execute('restore')).toContain('building cold');
		expect(existsSync(cache)).toBe(false);
		writeFileSync(archive, encrypted);
		execute('restore');
		for (const file of files)
			expect(readFileSync(path.join(cache, file), 'utf8')).toBe('private fixture content');
		expect(compilerCacheFiles(cache)).toContain(files[1]);
		expect(JSON.parse(readFileSync(path.join(cache, 'history-current.json'), 'utf8'))).toEqual([
			files[1]
		]);
		expect(existsSync(path.join(cache, staleParser))).toBe(false);
		expect(existsSync(path.join(cache, staleSocial))).toBe(false);
		expect(existsSync(path.join(cache, staleHistory))).toBe(false);
		expect(existsSync(path.join(cache, 'credentials.env'))).toBe(false);
	});
}, 30000);

test('missing keys and missing archives need no cache setup', () => {
	cacheFixture(({ directory, execute }) => {
		expect(execute('save', '')).toContain('skipping cache save');
		expect(existsSync(path.join(directory, 'build/generated/compiler-cache.gpg'))).toBe(false);
		expect(existsSync(path.join(directory, 'outputs'))).toBe(false);
		expect(execute('restore')).toContain('No compatible cache archive was restored');
	});
});
