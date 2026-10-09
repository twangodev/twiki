import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import {
	requiredFiles,
	validatePackagePlan,
	verifyArchive
} from '../../../.github/scripts/verify-package.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const expected = { name: 'twiki', version: '1.2.3' };
const paths = [...requiredFiles, 'site/static/fonts/example.woff2', 'site/migrations/0001.sql'];
function plan(names = paths) {
	return [
		{ ...expected, filename: 'twiki-1.2.3.tgz', files: names.map((name) => ({ path: name })) }
	];
}

test('release package requires the immutable runtime and permits both staged dependency manifests', () => {
	expect(validatePackagePlan(plan(), expected).version).toBe('1.2.3');
	expect(() => validatePackagePlan(plan([...paths, 'bun.lock']), expected)).not.toThrow();
	for (const missing of ['site/bun.lock', 'site/package.json', 'cli/runtime.ts']) {
		expect(() =>
			validatePackagePlan(plan(paths.filter((name) => name !== missing)), expected)
		).toThrow();
	}
	expect(() => validatePackagePlan([...plan(), ...plan()], expected)).toThrow();
	expect(() => validatePackagePlan(plan([...paths, paths[0]]), expected)).toThrow();
	expect(() =>
		validatePackagePlan([{ ...plan()[0], filename: '../twiki.tgz' }], expected)
	).toThrow();
	expect(() => validatePackagePlan(plan(), { ...expected, version: '1.2.4' })).toThrow();
});

test('release package rejects source content, generated state and configuration secrets', () => {
	for (const unsafe of [
		'content/private.md',
		'site/build/private.json',
		'site/src/lib/generated/page.json',
		'site/tooling/../private.md',
		'site/tooling/.env.production',
		'site/tooling/.dev.vars',
		'site/tooling/.npmrc',
		'site/tooling/node_modules/file.js',
		'site/tooling/.git/config',
		'site/tooling/.twiki/config.json',
		'site/tooling/a\\b.ts',
		'site/tooling/a\nfile.ts'
	])
		expect(() => validatePackagePlan(plan([...paths, unsafe]), expected)).toThrow();
});

test('actual release archive must exactly match its inspected inventory and contain regular files', () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), 'twiki-release-archive-'));
	try {
		mkdirSync(path.join(directory, 'package'));
		writeFileSync(path.join(directory, 'package/a'), 'verified runtime');
		const archive = path.join(directory, 'package.tgz');
		execFileSync('tar', ['-czf', archive, '-C', directory, 'package/a']);
		expect(() => verifyArchive(archive, ['a'])).not.toThrow();
		expect(() => verifyArchive(archive, ['a', 'unexpected'])).toThrow();
		symlinkSync('a', path.join(directory, 'package/link'));
		execFileSync('tar', ['-czf', archive, '-C', directory, 'package/a', 'package/link']);
		expect(() => verifyArchive(archive, ['a', 'link'])).toThrow(/nonregular/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test('release grants OIDC only to publishing the validated tarball on protected release tags', () => {
	const workflow = parse(readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8'));
	expect(workflow.on).toEqual({ push: { tags: ['v*'] } });
	expect(workflow.permissions).toEqual({ contents: 'read' });
	expect(workflow.jobs.publish.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
	expect(workflow.jobs.publish.environment).toBe('npm');
	expect(workflow.jobs.publish.needs).toBe('validate');
	const validate = workflow.jobs.validate.steps;
	const publish = workflow.jobs.publish.steps;
	for (const step of [...validate, ...publish].filter((step) => step.uses)) {
		expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
	}
	const identity = validate.find((step) => step.id === 'version').run;
	expect(identity).toContain("process.env.GITHUB_REF_NAME, 'v' + pkg.version");
	expect(identity).toContain('git merge-base --is-ancestor HEAD refs/remotes/origin/main');
	const publishText = JSON.stringify(publish);
	expect(publishText).toContain('EXPECTED_SHA256');
	expect(publishText).toContain(
		'npm publish dist/twiki.tgz --access public --provenance --ignore-scripts'
	);
	expect(publishText).not.toMatch(
		/NPM_TOKEN|NODE_AUTH_TOKEN|secrets\.|bun install|npm pack|actions\/checkout/
	);
});
