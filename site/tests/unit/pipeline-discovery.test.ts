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
let pipelines = 0;
let failDuringEmit = false;
let partialPage;
console.log = (...args) => {
  log(...args);
  if (String(args[0]).startsWith("content pipeline:")) pipelines++;
  if (String(args[0]).startsWith('emit:') && failDuringEmit) {
    failDuringEmit = false;
    partialPage = fs.statSync('build/generated/pages/sp99-cs101/notes/public.json', {bigint: true});
    fs.writeFileSync(path.join(${JSON.stringify(fixture.course)}, 'notes/during-build-1.md'), '# Changed during failed emission');
    throw new Error('Input changed during emission');
  }
  if (!String(args[0]).startsWith('parse:') || additions >= 2) return;
  const file = 'notes/during-build-' + ++additions + '.md';
  fs.writeFileSync(path.join(${JSON.stringify(fixture.course)}, file), '# Added during compilation ' + additions);
  if (additions === 1) fs.writeFileSync(path.join(${JSON.stringify(fixture.course)}, 'publish.yaml'), 'include: []\\n');
  execFileSync('git', ['-C', ${JSON.stringify(fixture.course)}, 'add', file]);
};
await prepareContent(false, undefined, true);
assert.equal(pipelines, 3);
for (let i = 1; i <= 2; i++)
  assert(fs.existsSync('build/generated/pages/sp99-cs101/notes/during-build-' + i + '.json'));
assert.equal(JSON.parse(fs.readFileSync('build/generated/pages/sp99-cs101/notes/public.json', 'utf8')).publication.public, false);
const saved = JSON.parse(fs.readFileSync('build/generated/dev-state.json', 'utf8'));
assert.equal(saved.inputs, contentInputFingerprint(${JSON.stringify(fixture.repo)}, process.env.TWIKI_PREPARED_CONTENT_KEY));
assert.equal(saved.outputs, contentOutputFingerprint(process.cwd()));
await prepareContent(true, undefined, true);
assert(!fs.existsSync('build/generated/expected-404.json'));
assert(!fs.existsSync('build/generated/expected-missing-id.json'));
const note = path.join(${JSON.stringify(fixture.course)}, 'notes/public.md');
let before = pipelines;
fs.writeFileSync(note, '# Reported edit');
await prepareContent(false, new Set([note]), true);
assert.equal(pipelines, before + 1);
before = pipelines;
fs.writeFileSync(note, '# Second reported edit');
fs.writeFileSync(path.join(${JSON.stringify(fixture.course)}, 'notes/second.md'), '# Unreported edit');
await prepareContent(false, new Set([note]), true);
assert.equal(pipelines, before + 2);
assert(JSON.parse(fs.readFileSync('build/generated/pages/sp99-cs101/notes/second.json', 'utf8')).html.includes('Unreported edit'));
fs.writeFileSync(note, '# Reported after missed deletion');
fs.rmSync(path.join(${JSON.stringify(fixture.course)}, 'notes/second.md'));
await prepareContent(false, new Set([note]), true);
assert(!fs.existsSync('build/generated/pages/sp99-cs101/notes/second.json'));
assert(JSON.parse(fs.readFileSync('build/generated/pages/sp99-cs101/notes/public.json', 'utf8')).html.includes('Reported after missed deletion'));
// Preserve invalidations even if a failed pass already wrote the final page bytes.
before = pipelines;
fs.writeFileSync(note, '# Updated before failure');
failDuringEmit = true;
const recovered = await prepareContent(false, new Set([note]), true);
assert.equal(pipelines, before + 1);
const page = path.resolve('build/generated/pages/sp99-cs101/notes/public.json');
assert(recovered.has(page));
assert.equal(fs.statSync(page, {bigint: true}).ino, partialPage.ino);
assert.equal(fs.statSync(page, {bigint: true}).mtimeNs, partialPage.mtimeNs);
assert(JSON.parse(fs.readFileSync('build/generated/pages/sp99-cs101/notes/during-build-1.json', 'utf8')).html.includes('Changed during failed emission'));


await prepareContent(false, undefined, false);
assert(Array.isArray(JSON.parse(fs.readFileSync('build/generated/expected-404.json', 'utf8'))));
assert(Array.isArray(JSON.parse(fs.readFileSync('build/generated/expected-missing-id.json', 'utf8'))));
console.log('validated snapshot reconciliation passed');
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
		expect(output).toContain('validated snapshot reconciliation passed');
		expect(output).toContain('reused saved output');
	} finally {
		rmSync(fixture.repo, { recursive: true, force: true });
	}
}, 30_000);
