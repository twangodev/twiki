import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { compilerCacheFiles } from '../../tooling/lib/cache-selection';

type Step = {
	id?: string;
	name?: string;
	if?: string;
	uses?: string;
	run?: string;
	'continue-on-error'?: boolean;
	'timeout-minutes'?: number;
	env?: Record<string, string>;
	with?: {
		path?: string;
		key?: string;
		'restore-keys'?: string;
		mode?: string;
		namespace?: string;
		transport?: string;
	};
};
const workflow = parse(readFileSync('../.github/workflows/svelte.yml', 'utf8')) as {
	concurrency?: unknown;
	on: {
		workflow_dispatch: {
			inputs: Record<string, { type: string; default: string | boolean; options?: string[] }>;
		};
	};
	env?: Record<string, string>;
	jobs: Record<
		string,
		{
			steps: Step[];
			if?: string;
			env?: Record<string, string>;
			concurrency: { group: string; 'cancel-in-progress': boolean };
		}
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
		"github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && !inputs.performance && inputs.live_test != 'deploy' && inputs.live_test != 'rollback' && (inputs.cache_benchmark == 'off' || !inputs.cache_benchmark)"
	);
	for (const [name, job] of Object.entries(workflow.jobs)) {
		if (name === 'build-and-deploy' || name === 'performance' || name === 'cache-benchmark')
			continue;
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
		deployment.steps.findIndex((step) => step.run === 'bun run deploy:incremental')
	);
	expect(deployment.steps[encrypted]['continue-on-error']).toBe(true);
	expect(save['continue-on-error']).toBe(true);
});

test('manual performance mode isolates benchmarks from production and normal checks', () => {
	expect(workflow.jobs.performance.if).toBe(
		"github.event_name == 'workflow_dispatch' && inputs.performance && inputs.live_test != 'deploy' && inputs.live_test != 'rollback' && (inputs.cache_benchmark == 'off' || !inputs.cache_benchmark)"
	);
	for (const name of ['check', 'unit-tests', 'browser-tests'])
		expect(workflow.jobs[name].if).toBe(
			"github.event_name != 'workflow_dispatch' || (!inputs.performance && (inputs.cache_benchmark == 'off' || !inputs.cache_benchmark))"
		);
	expect(workflow.jobs['build-and-deploy'].if).toContain('&& !inputs.performance');
	const steps = workflow.jobs.performance.steps;
	expect(steps.some((step) => /wrangler/.test(step.run ?? ''))).toBe(false);
	expect(steps.some((step) => step.uses?.includes('upload-artifact'))).toBe(false);
});

test('manual build mode selection cannot alter production deployment', () => {
	const input = workflow.on.workflow_dispatch.inputs.build_mode;
	expect(input.type).toBe('choice');
	expect(input.default).toBe('ssr');
	expect(input.options).toEqual(['ssr', 'serial', 'parallel', 'isolated-serial']);
	expect(workflow.env?.WISCONSIN_BUILD_MODE).toBeUndefined();
	for (const [name, job] of Object.entries(workflow.jobs)) {
		if (name === 'performance') continue;
		expect(job.env?.WISCONSIN_BUILD_MODE).toBeUndefined();
		expect(JSON.stringify(job)).not.toContain('inputs.build_mode');
		for (const step of job.steps) expect(step.env?.WISCONSIN_BUILD_MODE).toBeUndefined();
	}
	const performance = workflow.jobs.performance;
	expect(performance.env?.WISCONSIN_BUILD_MODE).toBe(
		"${{ inputs.build_mode == 'ssr' && 'serial' || inputs.build_mode || 'serial' }}"
	);
	const diagnostics = performance.steps.findIndex(
		(step) => step.name === 'Record benchmark build mode'
	);
	const first = performance.steps.findIndex(
		(step) => step.run === 'bun tooling/benchmark.ts build ci-first'
	);
	expect(diagnostics).toBeGreaterThan(-1);
	expect(diagnostics).toBeLessThan(first);
	expect(performance.steps[diagnostics].run).toContain(
		'JSON.stringify({ buildMode, fontIdentityVerified, probeMilliseconds })'
	);
	expect(performance.steps[diagnostics].run).toContain('Unsupported benchmark build mode');
	expect(performance.steps[diagnostics].run).toContain('rFontIdentity()');
	expect(performance.steps[diagnostics].run).toContain('/^fontconfig-v1:[a-f0-9]{64}$/');
	expect(performance.steps[diagnostics].run).not.toContain('console.log(fontIdentity)');
	expect(performance.steps[diagnostics].run).not.toContain('FONTCONFIG_PATH');
	for (const step of performance.steps.filter((step) =>
		step.run?.includes('tooling/benchmark.ts build')
	))
		expect(step.env?.WISCONSIN_BUILD_MODE).toBeUndefined();
	expect(
		workflow.jobs['build-and-deploy'].steps.some((step) => step.run === 'bun run build:all')
	).toBe(true);
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
	const renderer = steps.find((step) => step.name === 'Install R worksheet renderer')!;
	expect(renderer.run).toContain('Acquire::Retries=2');
	expect(renderer.run).toContain('Acquire::http::Timeout=30');
	expect(renderer.run).toContain('--no-install-recommends r-base-core r-cran-knitr r-cran-car');
	for (const name of ['check', 'browser-tests'])
		expect(workflow.jobs[name].steps.find((step) => step.name === renderer.name)).toEqual(renderer);
	const productionRenderer = workflow.jobs['build-and-deploy'].steps.find(
		(step) => step.name === renderer.name
	)!;
	expect(productionRenderer.run).toBe(renderer.run);
	expect(productionRenderer['timeout-minutes']).toBe(renderer['timeout-minutes']);
	expect(productionRenderer.if).toBe("steps.worksheets.outputs.requiresR != 'false'");
	expect(steps[diagnostics].run).toContain('packageVersion("car")');
	const summary = steps[warm + 1];
	expect(summary.if).toBe('always()');
	expect(summary.run).toContain('GITHUB_STEP_SUMMARY');
	expect(summary.run).toContain(
		'const result = { success, seconds, exitCode, exitSignal, host, buildMode: process.env.WISCONSIN_BUILD_MODE }'
	);
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
		execute('Encrypt compiler cache');
		expect(existsSync(path.join(cache, staleParser))).toBe(true);
		expect(existsSync(path.join(cache, staleSocial))).toBe(true);
		expect(existsSync(path.join(cache, staleHistory))).toBe(true);
		expect(readFileSync(path.join(directory, 'outputs'), 'utf8')).toBe('ready=true\n');
		const archive = path.join(directory, 'build/generated/compiler-cache.gpg');
		const encrypted = readFileSync(archive);
		expect(encrypted.includes(Buffer.from('private fixture content'))).toBe(false);
		rmSync(cache, { recursive: true });
		rmSync(historyOutput, { recursive: true });
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
		if (name === 'live-test') {
			expect(job.concurrency.group).toBe(
				workflow.jobs['build-and-deploy'].concurrency.group.replace(
					'${{ github.ref }}',
					'refs/heads/main'
				)
			);
			expect(job.if).toContain("github.ref == 'refs/heads/perf/build-performance'");
		} else expect(job.concurrency.group).toContain('${{ github.ref }}');
		expect(job.concurrency['cancel-in-progress']).toBe(
			!['build-and-deploy', 'live-test', 'cache-benchmark'].includes(name)
		);
	}
	expect(groups.size).toBe(Object.keys(workflow.jobs).length);
});

test('deployment skips R only after verified restored worksheet coverage', () => {
	for (const name of ['build-and-deploy', 'live-test']) {
		const job = workflow.jobs[name];
		expect(job.env?.WISCONSIN_R_REQUIRE_PROFILE).toBe('1');
		const restore = job.steps.findIndex((step) => step.with?.mode === 'restore');
		const preflight = job.steps.findIndex((step) => step.id === 'worksheets');
		const fonts = job.steps.findIndex((step) => step.name === 'Provision pinned worksheet fonts');
		const renderer = job.steps.findIndex((step) => step.name === 'Install R worksheet renderer');
		const enforce = job.steps.findIndex(
			(step) => step.name === 'Enforce verified worksheet cache reuse'
		);
		const build = job.steps.findIndex((step) => step.run === 'bun run build:all');
		expect(restore).toBeGreaterThan(-1);
		expect(preflight).toBeGreaterThan(restore);
		expect(preflight).toBeGreaterThan(fonts);
		expect(fonts).toBeGreaterThan(-1);
		expect(job.steps[fonts].run).toContain('fonts-mathjax=2.7.9+dfsg-1');
		expect(job.steps[fonts].run).toContain(
			'fonts-glyphicons-halflings=1.009~3.4.1+dfsg-3+deb12u1build0.24.04.1'
		);
		expect(renderer).toBeGreaterThan(preflight);
		expect(enforce).toBeGreaterThan(renderer);
		expect(build).toBeGreaterThan(enforce);
		expect(job.steps[renderer].if).toContain("steps.worksheets.outputs.requiresR != 'false'");
		expect(job.steps[enforce].if).toContain("steps.worksheets.outputs.requiresR == 'false'");
		expect(job.steps[enforce].run).toContain('WISCONSIN_R_CACHE_ONLY=1');
	}
});

test('complete cache experiments remain manual, isolated and nondeploying with measurable complete hits', () => {
	const job = workflow.jobs['cache-benchmark'];
	expect(job.if).toContain("github.event_name == 'workflow_dispatch'");
	expect(job.if).toContain("github.ref == 'refs/heads/perf/build-performance'");
	expect(job.if).toContain("inputs.live_test != 'deploy'");
	expect(JSON.stringify(job)).not.toContain('CLOUDFLARE_API_TOKEN');
	expect(job.steps.some((step) => /wrangler|deploy:incremental/.test(step.run ?? ''))).toBe(false);
	const restore = job.steps.find((step) => step.name === 'Restore isolated complete products')!;
	expect(restore.with).toEqual({ mode: 'restore', namespace: 'benchmark', transport: 'bundle' });
	const save = job.steps.find((step) => step.name === 'Save isolated complete products')!;
	expect(save.if).toBe("inputs.cache_benchmark == 'seed'");
	const hits = job.steps.find(
		(step) => step.name === 'Require complete product hits on a fresh runner'
	)!;
	expect(hits.run).toContain('"$RESTORED_PRODUCTS" -eq "$REQUESTED_PRODUCTS"');
	expect(hits.run).toContain('"$MISSING_PRODUCTS" -eq 0');
	expect(hits.run).toContain('"$REBUILD_PRODUCTS" -eq 0');
	expect(hits.run).toContain('"$FAILED_PRODUCTS" -eq 0');
	expect(hits.if).toContain("inputs.cache_benchmark == 'edit'");
	const edit = job.steps.find(
		(step) => step.name === 'Edit one public note in the disposable checkout'
	)!;
	expect(edit.if).toBe("inputs.cache_benchmark == 'edit'");
	expect(edit.run).toContain('appendFileSync');
	expect(edit.run).not.toMatch(/git (commit|push)|wrangler/);
});
