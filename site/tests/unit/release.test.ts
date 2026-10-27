import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { requiredFiles, validatePackagePlan, verifyArchive } from '../../../tooling/package.mjs';

import { verifyReleaseIdentity } from '../../../tooling/release';

const root = path.resolve(import.meta.dirname, '../../..');
const expected = { name: '@twango/twiki', version: '1.2.3' };
const paths = [...requiredFiles, 'site/static/fonts/example.woff2', 'site/migrations/0001.sql'];
function plan(names = paths) {
	return [
		{
			...expected,
			filename: 'twango-twiki-1.2.3.tgz',
			files: names.map((name) => ({ path: name }))
		}
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

test('release publishes the Release Please commit after CI passes', () => {
	const workflow = parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
	const release = workflow.jobs['release-please'];
	const publish = workflow.jobs.publish;
	const docker = workflow.jobs.docker;
	expect(workflow.permissions).toEqual({ contents: 'read' });
	expect(release.if).toBe(
		"github.repository == 'twangodev/twiki' && github.ref == 'refs/heads/main' && github.event_name == 'push'"
	);
	expect(workflow.jobs.validate).toBeUndefined();
	for (const job of [publish, docker]) {
		expect(job.needs).toEqual(['test', 'release-please']);
		expect(job.if).toBe("needs.release-please.outputs.release_created == 'true'");
		expect(job.steps[0].with.ref).toBe('${{ needs.release-please.outputs.sha }}');
	}
	expect(publish.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
	expect(publish.environment).toBe('npm');
	const npm = publish.steps.find((step) => step.name === 'Publish with npm OIDC');
	expect(npm.run).toContain('npm publish . --access public --provenance --ignore-scripts');
	expect(npm.env.NPM_DIST_TAG).toBe(
		"${{ contains(needs.release-please.outputs.tag_name, '-') && 'next' || 'latest' }}"
	);
	expect(JSON.stringify(publish)).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|bun audit/);
});

test('release identity rejects a version mismatch, wrong checkout, and missing or moved tags', () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), 'twiki-release-identity-'));
	const git = (...args: string[]) =>
		execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
	try {
		git('init', '-b', 'main');
		git('config', 'user.name', 'Release test');
		git('config', 'user.email', 'release@example.invalid');
		git('config', 'commit.gpgsign', 'false');
		writeFileSync(path.join(directory, 'package.json'), JSON.stringify(expected));
		git('add', 'package.json');
		git('commit', '-m', 'fix: fixture');
		const sha = git('rev-parse', 'HEAD');
		git('tag', 'v1.2.3');
		expect(() => verifyReleaseIdentity(directory, 'v1.2.3', sha)).not.toThrow();
		expect(() => verifyReleaseIdentity(directory, 'v1.2.4', sha)).toThrow();
		expect(() => verifyReleaseIdentity(directory, 'v1.2.3', '0'.repeat(40))).toThrow();
		expect(() => verifyReleaseIdentity(directory, 'v1.2.3', '')).toThrow();
		git('tag', '-d', 'v1.2.3');
		expect(() => verifyReleaseIdentity(directory, 'v1.2.3', sha)).toThrow();
		git('tag', 'v1.2.3');
		git('commit', '--allow-empty', '-m', 'fix: next');
		const next = git('rev-parse', 'HEAD');
		expect(() => verifyReleaseIdentity(directory, 'v1.2.3', next)).toThrow();
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
