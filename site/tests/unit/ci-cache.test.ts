import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

type Step = {
	uses?: string;
	run?: string;
	with?: { path?: string; key?: string; 'restore-keys'?: string };
};
const workflow = parse(readFileSync('../.github/workflows/svelte.yml', 'utf8')) as {
	jobs: Record<string, { steps: Step[]; if?: string }>;
};
const compilerPaths = [
	'site/.generated/cache/stage1',
	'site/.generated/cache/file-history',
	'site/.generated/cache/gitdates-v2-*.json',
	'site/.generated/cache/social-titles'
];

test('CI caches only dependencies and explicitly selected compiler data', () => {
	for (const job of Object.values(workflow.jobs)) {
		for (const step of job.steps.filter((step) => step.uses?.startsWith('actions/cache'))) {
			const paths = step.with?.path?.trim().split('\n');
			if (paths?.[0] === '~/.bun/install/cache') expect(paths).toHaveLength(1);
			else expect(paths).toEqual(compilerPaths);
		}
	}
});

test('build jobs restore compatible caches from previous runs before preparing content', () => {
	const prefixes = new Set<string>();
	for (const name of ['check', 'browser-tests', 'build-and-deploy']) {
		const { steps } = workflow.jobs[name];
		const index = steps.findIndex((step) => step.with?.key?.startsWith('compiler-v1-'));
		expect(index).toBeGreaterThan(-1);
		const cache = steps[index];
		const key = cache.with!.key!;
		const prefix = cache.with!['restore-keys']!;
		prefixes.add(prefix);
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
		expect(cache.uses).toBe(
			name === 'build-and-deploy' ? 'actions/cache@v6' : 'actions/cache/restore@v6'
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
		for (const step of job.steps.filter((step) => step.with?.key?.startsWith('compiler-v1-')))
			expect(step.uses).toBe('actions/cache/restore@v6');
	}
});
