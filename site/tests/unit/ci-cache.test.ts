import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';

type Step = {
	id?: string;
	name?: string;
	if?: string;
	uses?: string;
	run?: string;
	with?: { path?: string; key?: string; 'restore-keys'?: string };
};
const workflow = parse(readFileSync('../.github/workflows/svelte.yml', 'utf8')) as {
	concurrency?: unknown;
	jobs: Record<
		string,
		{ steps: Step[]; if?: string; concurrency: { group: string; 'cancel-in-progress': boolean } }
	>;
};
test('CI uploads only dependencies and encrypted compiler data', () => {
	for (const job of Object.values(workflow.jobs)) {
		for (const step of job.steps.filter((step) => step.uses?.startsWith('actions/cache'))) {
			const paths = step.with?.path?.trim().split('\n');
			if (paths?.[0] === '~/.bun/install/cache') expect(paths).toHaveLength(1);
			else expect(paths).toEqual(['site/build/generated/compiler-cache.gpg']);
		}
	}
});

test('build jobs restore compatible caches from previous runs before preparing content', () => {
	const prefixes = new Set<string>();
	for (const name of ['check', 'browser-tests', 'build-and-deploy']) {
		const { steps } = workflow.jobs[name];
		const index = steps.findIndex((step) => step.id === 'compiler-cache');
		expect(index).toBeGreaterThan(-1);
		const cache = steps[index];
		const key = cache.with!.key!;
		const prefix = cache.with!['restore-keys']!;
		prefixes.add(prefix);
		expect(prefix).toStartWith('compiler-encrypted-v1-');
		expect(key).toBe(prefix + '${{ github.run_id }}-${{ github.run_attempt }}');
		for (const input of [
			'site/bun.lock',
			'site/tooling/**',
			'site/src/lib/config.ts',
			'site/src/lib/metadata.ts',
			'site/src/lib/types.ts'
		])
			expect(prefix).toContain(input);
		const build = steps.findIndex((step) =>
			/bun run (check|test:content|build:all)/.test(step.run ?? '')
		);
		expect(index).toBeLessThan(build);
		expect(cache.uses).toBe('actions/cache/restore@v6');
		expect(steps[index + 1].name).toBe('Decrypt compiler cache');
		expect(index + 1).toBeLessThan(build);
		expect(index + 1).toBeLessThan(
			steps.findIndex((step) => step.run === 'bun install --frozen-lockfile')
		);
	}
	expect(prefixes.size).toBe(1);
});

test('only trusted main-branch deployment runs save compiler caches', () => {
	const deployment = workflow.jobs['build-and-deploy'];
	expect(deployment.if).toBe(
		"github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')"
	);
	for (const [name, job] of Object.entries(workflow.jobs)) {
		if (name === 'build-and-deploy') continue;
		for (const step of job.steps.filter(
			(step) => step.with?.path === 'site/build/generated/compiler-cache.gpg'
		))
			expect(step.uses).toBe('actions/cache/restore@v6');
	}
	const save = deployment.steps.find((step) => step.uses === 'actions/cache/save@v6')!;
	expect(save.if).toBe("steps.encrypted-cache.outputs.ready == 'true'");
	expect(save.with?.key).toBe('${{ steps.compiler-cache.outputs.cache-primary-key }}');
	expect(deployment.steps.findIndex((step) => step.id === 'encrypted-cache')).toBeGreaterThan(
		deployment.steps.findIndex((step) => step.run === 'bunx wrangler deploy')
	);
});

function cacheFixture(
	run: (fixture: {
		directory: string;
		key: string;
		execute: (name: string, key?: string) => string;
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
			execute(name, secret = key) {
				const step = workflow.jobs['build-and-deploy'].steps.find((step) => step.name === name)!;
				const result = spawnSync(
					'bash',
					[
						'--noprofile',
						'--norc',
						'-e',
						'-o',
						'pipefail',
						'-c',
						step.run!.replace('tooling/cache.ts', JSON.stringify(path.resolve('tooling/cache.ts')))
					],
					{
						cwd: directory,
						env: { ...env, BUILD_CACHE_KEY: secret },
						encoding: 'utf8',
						timeout: 15000
					}
				);
				expect(result.status).toBe(0);
				return result.stdout;
			}
		});
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test('workflow encryption restores selected files and rejects wrong keys and tampering', () => {
	cacheFixture(({ directory, execute }) => {
		const cache = path.join(directory, 'build/generated/cache');
		const files = [
			'stage1/ab/note.json',
			'file-history/course/blame.json',
			'gitdates-v2-course-head.json',
			'social-titles/card.png'
		];
		for (const file of files) {
			mkdirSync(path.dirname(path.join(cache, file)), { recursive: true });
			writeFileSync(path.join(cache, file), 'private fixture content');
		}
		writeFileSync(path.join(cache, 'credentials.env'), 'excluded fixture');
		execute('Encrypt compiler cache');
		expect(readFileSync(path.join(directory, 'outputs'), 'utf8')).toBe('ready=true\n');
		const archive = path.join(directory, 'build/generated/compiler-cache.gpg');
		const encrypted = readFileSync(archive);
		expect(encrypted.includes(Buffer.from('private fixture content'))).toBe(false);
		rmSync(cache, { recursive: true });
		expect(execute('Decrypt compiler cache', '')).toContain('building cold');
		expect(existsSync(cache)).toBe(false);
		expect(execute('Decrypt compiler cache', 'wrong-key')).toContain('building cold');
		expect(existsSync(cache)).toBe(false);
		const tampered = Buffer.from(encrypted);
		tampered[tampered.length - 1] ^= 1;
		writeFileSync(archive, tampered);
		expect(execute('Decrypt compiler cache')).toContain('building cold');
		expect(existsSync(cache)).toBe(false);
		const unencrypted = spawnSync('gpg', ['--batch', '--yes', '--store', '--output', archive], {
			env: { ...process.env, GNUPGHOME: directory },
			input: 'unauthenticated cache'
		});
		expect(unencrypted.status).toBe(0);
		expect(execute('Decrypt compiler cache')).toContain('building cold');
		expect(existsSync(cache)).toBe(false);
		writeFileSync(archive, encrypted);
		execute('Decrypt compiler cache');
		for (const file of files)
			expect(readFileSync(path.join(cache, file), 'utf8')).toBe('private fixture content');
		expect(existsSync(path.join(cache, 'credentials.env'))).toBe(false);
	});
}, 30000);

test('missing keys and missing archives need no cache setup', () => {
	cacheFixture(({ directory, execute }) => {
		expect(execute('Encrypt compiler cache', '')).toContain('skipping cache save');
		expect(existsSync(path.join(directory, 'build/generated/compiler-cache.gpg'))).toBe(false);
		expect(existsSync(path.join(directory, 'outputs'))).toBe(false);
		expect(execute('Decrypt compiler cache')).toContain('building cold');
	});
});

test('slow checks do not queue deployment and active deployments finish safely', () => {
	expect(workflow.concurrency).toBeUndefined();
	const groups = new Set<string>();
	for (const [name, job] of Object.entries(workflow.jobs)) {
		groups.add(job.concurrency.group);
		expect(job.concurrency.group).toContain('${{ github.ref }}');
		expect(job.concurrency['cancel-in-progress']).toBe(name !== 'build-and-deploy');
	}
	expect(groups.size).toBe(Object.keys(workflow.jobs).length);
});
