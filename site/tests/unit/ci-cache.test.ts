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
	'continue-on-error'?: boolean;
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
		expect(prefix).toBe('compiler-encrypted-v2-${{ runner.os }}-${{ runner.arch }}-');
		expect(key).toBe(prefix + '${{ github.run_id }}-${{ github.run_attempt }}');
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

test('only production and explicitly requested benchmarks save compiler caches', () => {
	const deployment = workflow.jobs['build-and-deploy'];
	expect(deployment.if).toBe(
		"github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && !inputs.performance"
	);
	for (const [name, job] of Object.entries(workflow.jobs)) {
		if (name === 'build-and-deploy' || name === 'performance') continue;
		for (const step of job.steps.filter(
			(step) => step.with?.path === 'site/build/generated/compiler-cache.gpg'
		))
			expect(step.uses).toBe('actions/cache/restore@v6');
	}
	const save = deployment.steps.find((step) => step.uses === 'actions/cache/save@v6')!;
	expect(save.if).toBe("steps.encrypted-cache.outputs.ready == 'true'");
	expect(save.with?.key).toBe('${{ steps.compiler-cache.outputs.cache-primary-key }}');
	const encrypted = deployment.steps.findIndex((step) => step.id === 'encrypted-cache');
	expect(encrypted).toBeGreaterThan(
		deployment.steps.findIndex((step) => step.run === 'bun run build:all')
	);
	expect(encrypted).toBeGreaterThan(
		deployment.steps.findIndex((step) => step.run === 'bunx wrangler deploy')
	);
	expect(deployment.steps[encrypted]['continue-on-error']).toBe(true);
	expect(save['continue-on-error']).toBe(true);
});

test('manual performance mode isolates benchmarks from production and normal checks', () => {
	expect(workflow.jobs.performance.if).toBe(
		"github.event_name == 'workflow_dispatch' && inputs.performance"
	);
	for (const name of ['check', 'unit-tests', 'browser-tests'])
		expect(workflow.jobs[name].if).toBe(
			"github.event_name != 'workflow_dispatch' || !inputs.performance"
		);
	expect(workflow.jobs['build-and-deploy'].if).toContain('&& !inputs.performance');
	const steps = workflow.jobs.performance.steps;
	expect(steps.some((step) => /wrangler/.test(step.run ?? ''))).toBe(false);
	expect(steps.some((step) => step.uses?.includes('upload-artifact'))).toBe(false);
});

test('manual benchmarks retain production setup and publish only measurement metadata', () => {
	const { steps } = workflow.jobs.performance;
	const first = steps.findIndex((step) => step.run === 'bun tooling/benchmark.ts build ci-first');
	const warm = steps.findIndex((step) => step.run === 'bun tooling/benchmark.ts build ci-warm');
	const diagnostics = steps.findIndex((step) => step.name === 'Record build runtimes');
	expect(first).toBeGreaterThan(diagnostics);
	expect(warm).toBe(first + 1);
	expect(diagnostics).toBeGreaterThan(
		steps.findIndex((step) => step.run === 'bun install --frozen-lockfile')
	);
	expect(steps.find((step) => step.id === 'compiler-cache')?.uses).toBe('actions/cache/restore@v6');
	expect(steps.some((step) => step.name === 'Install R worksheet renderer')).toBe(true);
	const summary = steps[warm + 1];
	expect(summary.if).toBe('always()');
	expect(summary.run).toContain('GITHUB_STEP_SUMMARY');
	expect(summary.run).toContain('const result = { success, seconds, exitCode, exitSignal, host }');
	expect(summary.run).not.toContain('.log');
	const encryption = steps.findIndex((step) => step.id === 'encrypted-cache');
	const save = steps.findIndex((step) => step.uses === 'actions/cache/save@v6');
	expect(encryption).toBe(warm + 2);
	expect(save).toBe(encryption + 1);
	expect(steps[encryption]['continue-on-error']).toBe(true);
	expect(steps[save]['continue-on-error']).toBe(true);
	expect(steps[encryption]).toEqual(
		workflow.jobs['build-and-deploy'].steps.find((step) => step.id === 'encrypted-cache')!
	);
	expect(steps[save]).toEqual(
		workflow.jobs['build-and-deploy'].steps.find((step) => step.uses === 'actions/cache/save@v6')!
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
			`stage1/ab/${'a'.repeat(64)}.json`,
			'file-history/course/blame.json',
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
		writeFileSync(path.join(historyOutput, 'blame.json'), 'published history fixture');
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
		execute('Encrypt compiler cache');
		expect(existsSync(path.join(cache, staleParser))).toBe(true);
		expect(existsSync(path.join(cache, staleSocial))).toBe(true);
		expect(existsSync(path.join(cache, staleHistory))).toBe(true);
		expect(readFileSync(path.join(directory, 'outputs'), 'utf8')).toBe('ready=true\n');
		const archive = path.join(directory, 'build/generated/compiler-cache.gpg');
		const encrypted = readFileSync(archive);
		expect(encrypted.includes(Buffer.from('private fixture content'))).toBe(false);
		rmSync(cache, { recursive: true });
		expect(execute('Decrypt compiler cache', '')).toContain('BUILD_CACHE_KEY is missing');
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
		expect(existsSync(path.join(cache, staleParser))).toBe(false);
		expect(existsSync(path.join(cache, staleSocial))).toBe(false);
		expect(existsSync(path.join(cache, staleHistory))).toBe(false);
		expect(existsSync(path.join(cache, 'credentials.env'))).toBe(false);
	});
}, 30000);

test('missing keys and missing archives need no cache setup', () => {
	cacheFixture(({ directory, execute }) => {
		expect(execute('Encrypt compiler cache', '')).toContain('skipping cache save');
		expect(existsSync(path.join(directory, 'build/generated/compiler-cache.gpg'))).toBe(false);
		expect(existsSync(path.join(directory, 'outputs'))).toBe(false);
		expect(execute('Decrypt compiler cache')).toContain('No compatible cache archive was restored');
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
