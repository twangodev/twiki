import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { publicationFixture } from '../publication-fixture';

test('post-build validation and repeated reconciliation use fresh discovery snapshots', () => {
	const fixture = publicationFixture();
	const source = path.resolve(import.meta.dirname, '../..');
	const site = path.join(fixture.repo, 'site');
	mkdirSync(site);
	try {
		for (const file of [
			'tooling',
			'src/lib',
			'assets',
			'package.json',
			'bun.lock',
			'tsconfig.json'
		]) {
			const target = path.join(site, file);
			mkdirSync(path.dirname(target), { recursive: true });
			cpSync(path.join(source, file), target, {
				recursive: true,
				filter: (file) => !file.includes('/src/lib/generated')
			});
		}
		symlinkSync(path.resolve(source, '../node_modules'), path.join(site, 'node_modules'), 'dir');
		const output = execFileSync(
			'bun',
			[
				'-e',
				`
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepareContent } from './tooling/pipeline';
import { contentInputFingerprint, contentOutputFingerprint } from './tooling/lib/dev-state';
const log = console.log;
let additions = 0;
console.log = (...args) => {
  log(...args);
  if (!String(args[0]).startsWith('parse:') || additions >= 2) return;
  const file = 'notes/during-build-' + ++additions + '.md';
  fs.writeFileSync(path.join(${JSON.stringify(fixture.course)}, file), '# Added during compilation ' + additions);
  execFileSync('git', ['-C', ${JSON.stringify(fixture.course)}, 'add', file]);
};
await prepareContent(false, undefined, true);
for (let i = 1; i <= 2; i++)
  assert(fs.existsSync('build/generated/pages/sp99-cs101/notes/during-build-' + i + '.json'));
const saved = JSON.parse(fs.readFileSync('build/generated/dev-state.json', 'utf8'));
assert.equal(saved.inputs, contentInputFingerprint(${JSON.stringify(fixture.repo)}, process.env.TWIKI_PREPARED_CONTENT_KEY));
assert.equal(saved.outputs, contentOutputFingerprint(process.cwd()));
await prepareContent(true, undefined, true);
assert(!fs.existsSync('build/generated/expected-404.json'));
assert(!fs.existsSync('build/generated/expected-missing-id.json'));
await prepareContent(false, undefined, false);
assert(Array.isArray(JSON.parse(fs.readFileSync('build/generated/expected-404.json', 'utf8'))));
assert(Array.isArray(JSON.parse(fs.readFileSync('build/generated/expected-missing-id.json', 'utf8'))));
`
			],
			{
				cwd: site,
				env: {
					...process.env,
					TWIKI_PROJECT_ROOT: fixture.repo,
					TWIKI_CONFIG_FILE: '',
					TWIKI_CONTENT_DIR: path.join(fixture.repo, 'content'),
					VITE_PUBLIC_EDITION: 'false'
				},
				encoding: 'utf8',
				maxBuffer: 4 * 1024 * 1024,
				timeout: 25_000
			}
		);
		expect((output.match(/content pipeline:/g) ?? []).length).toBe(4);
		expect(output).toContain('reused saved output');
	} finally {
		rmSync(fixture.repo, { recursive: true, force: true });
	}
}, 30_000);
