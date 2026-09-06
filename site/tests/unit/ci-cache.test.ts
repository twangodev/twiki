import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

test('shared CI caches exclude private content and history', () => {
	const workflow = parse(readFileSync('../.github/workflows/svelte.yml', 'utf8'));
	for (const job of Object.values(workflow.jobs) as {
		steps: { uses?: string; with?: { path?: string } }[];
	}[]) {
		for (const step of job.steps.filter((step) => step.uses?.startsWith('actions/cache')))
			expect(['~/.bun/install/cache', 'site/.generated/cache/social-titles']).toContain(
				step.with?.path ?? ''
			);
	}
});
