import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { publicationFixture } from '../publication-fixture';

function prepareSite(site: string) {
	const source = path.resolve(import.meta.dirname, '../..');
	mkdirSync(site);
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
}

test('post-build validation and repeated reconciliation use fresh discovery snapshots', async () => {
	const fixture = publicationFixture();
	fixture.write('content/sp99-other/note.md', '# Other course');
	fixture.write('content/sp99-other/attachment.bin', 'Unchanged course attachment');
	fixture.write('content/sp99-other/image.svg', '<svg>Unchanged course image</svg>');
	execFileSync('git', ['-C', fixture.repo, 'add', 'content/sp99-other']);
	const site = path.join(fixture.repo, 'site');
	try {
		prepareSite(site);
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
assert.equal(saved.inputs, (await contentInputFingerprint(${JSON.stringify(fixture.repo)}, process.env.TWIKI_PREPARED_CONTENT_KEY)));
assert.equal(saved.outputs, contentOutputFingerprint(process.cwd()));
// The structural passes rendered new bodies. Validate their bytes before
// testing whether a later worker can carry those observations across restart.
await prepareContent(false, undefined, true);
assert(JSON.parse(fs.readFileSync('build/generated/dev-state.json', 'utf8')).bodies.files.length > 0);
// A fresh worker must restore course state only after validating the saved snapshot.
const restarted = execFileSync('bun', ['-e', ${JSON.stringify(`
import { strict as assert } from 'node:assert';
import { spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { prepareContent } from './tooling/pipeline';
const read = fs.readFileSync;
const index = JSON.parse(read('build/generated/cache/content-current-full.json', 'utf8'));
const body = process.cwd() + '/build/generated/cache/' + index.pages['sp99-other/note.md'].body;
const document = process.cwd() + '/build/generated/pages/sp99-other/note.json';
const cachedDocument = process.cwd() + '/build/generated/cache/' + index.pages['sp99-other/note.md'].document;
const unchanged = ${JSON.stringify(path.join(fixture.repo, 'content/sp99-other/attachment.bin'))};
const image = ${JSON.stringify(path.join(fixture.repo, 'content/sp99-other/image.svg'))};
let reads = 0;
let imageReads = 0;
let bodyReads = 0;
let documentReads = 0;
const spy = spyOn(fs, 'readFileSync').mockImplementation((file, ...args) => {
  if (String(file) === unchanged) reads++;
  if (String(file) === image) imageReads++;
  if (String(file) === body) bodyReads++;
  if (String(file) === document || String(file) === cachedDocument) documentReads++;
  return read(file, ...args);
});
const note = ${JSON.stringify(path.join(fixture.course, 'notes/public.md'))};
try {
  await prepareContent(true, undefined, true);
  reads = 0;
  imageReads = 0;
  bodyReads = 0;
  documentReads = 0;
  // Preserve catalog metadata so this exercises an ordinary body edit.
  fs.writeFileSync(note, read(note, 'utf8') + '\\nFirst edit after restart');
  await prepareContent(false, new Set([note]), true);
  assert.equal(reads, 1, 'only fresh filesystem source validation should read the unchanged attachment');
  assert.equal(imageReads, 1, 'only fresh filesystem source validation should read the unchanged compiled asset');
  assert.equal(bodyReads, 0, 'validated unchanged bodies should survive a fresh worker restart without rereading bytes');
  assert.equal(documentReads, 0, 'validated unchanged document copies should survive a fresh worker restart without rereading bytes');
  // Exercise the large-tree strategy without creating tens of thousands of fixture files.
  const { OutputCheckpoint } = await import('./tooling/lib/output-checkpoint');
  const descriptor = Object.getOwnPropertyDescriptor(OutputCheckpoint.prototype, 'fileCount');
  Object.defineProperty(OutputCheckpoint.prototype, 'fileCount', { configurable: true, get: () => 32768 });
  try {
  reads = 0;
  imageReads = 0;
  fs.writeFileSync(note, read(note, 'utf8') + '\\nSecond edit with compiler metadata');
  await prepareContent(false, new Set([note]), true);
  assert.equal(reads, 0, 'fresh source verification should run in the disposable worker');
  assert.equal(imageReads, 0, 'unchanged assets should only be read by the disposable validator');
  const validation = await import('./tooling/lib/input-validation');
  const unavailable = spyOn(validation, 'freshInputFingerprint').mockResolvedValue(undefined);
  try {
    reads = 0;
    fs.writeFileSync(note, read(note, 'utf8') + '\\nEdit with unavailable validation worker');
    await prepareContent(false, new Set([note]), true);
    assert.equal(reads, 1, 'failed worker validation must fall back to fresh in-process source reads');
  } finally { unavailable.mockRestore(); }
  } finally { Object.defineProperty(OutputCheckpoint.prototype, 'fileCount', descriptor); }
} finally { spy.mockRestore(); }
// A deferred pass must repair missing generated blobs from an otherwise reused course.
const unchangedIndex = 'build/generated/assets/_files/index/sp99-other.json';
const previousAttachment = JSON.parse(fs.readFileSync(unchangedIndex, 'utf8')).find(file => file.path === 'attachment.bin');
const generatedAttachment = 'build/generated/assets' + previousAttachment.download;
fs.rmSync(generatedAttachment);
fs.writeFileSync(note, read(note, 'utf8') + '\\nEdit after removing an unchanged course blob');
await prepareContent(false, new Set([note]), true);
assert.equal(fs.readFileSync(generatedAttachment, 'utf8'), 'Unchanged course attachment');
// An omitted watcher event must still invalidate restored course metadata.
fs.writeFileSync(unchanged, 'Unreported attachment edit');
fs.writeFileSync(note, '# Reported alongside an unreported course edit');
await prepareContent(false, new Set([note]), true);
const files = JSON.parse(fs.readFileSync('build/generated/assets/_files/index/sp99-other.json', 'utf8'));
const attachment = files.find(file => file.path === 'attachment.bin');
assert.equal(fs.readFileSync('build/generated/assets' + attachment.download, 'utf8'), 'Unreported attachment edit');
`)}], { cwd: process.cwd(), env: process.env, encoding: 'utf8' });
assert(restarted.includes('reused saved output'));
assert(restarted.includes('1 changed courses (1 reused)'));
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
// A missed replacement with a symlink must be removed before the build is accepted.
const replaced = path.join(${JSON.stringify(fixture.course)}, 'notes/during-build-2.md');
const outside = path.join(${JSON.stringify(fixture.repo)}, 'outside.md');
fs.writeFileSync(outside, '# Outside source boundary');
fs.rmSync(replaced);
fs.symlinkSync(outside, replaced);
fs.writeFileSync(note, '# Reported alongside missed symlink replacement');
before = pipelines;
await prepareContent(false, new Set([note]), true);
assert.equal(pipelines, before + 2);
assert(!fs.existsSync('build/generated/pages/sp99-cs101/notes/during-build-2.json'));
assert(!JSON.parse(fs.readFileSync('build/generated/content-manifest.json', 'utf8')).pages['sp99-cs101/notes/during-build-2']);

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

test('missed policy untracking rejects candidate Git snapshots before accepting output and recovers', async () => {
	const fixture = publicationFixture();
	const site = path.join(fixture.repo, 'site');
	fixture.write(
		'twiki.config.json',
		JSON.stringify({ version: 1, contentDir: 'content', discovery: 'git', publication: 'policies' })
	);
	try {
		prepareSite(site);
		const output = execFileSync(
			'bun',
			[
				'-e',
				`
import { strict as assert } from 'node:assert';
import { spyOn } from 'bun:test';
import fs from 'node:fs';
import * as childProcess from 'node:child_process';
import { prepareContent } from './tooling/pipeline';
import { coursePolicies } from './tooling/lib/publishing';
const git = (directory, ...args) => childProcess.execFileSync('git', ['-C', directory, ...args], {stdio: 'pipe'});
const calls = spyOn(childProcess, 'execFileSync');
await prepareContent(false, undefined, true);
assert.equal(calls.mock.calls.filter(([, args]) => args?.includes('--error-unmatch')).length, 0);
calls.mockRestore();
const manifest = () => JSON.parse(fs.readFileSync('build/generated/content-manifest.json', 'utf8'));
assert.equal(manifest().pages['sp99-cs101/notes/public'].publication.public, true);
git(${JSON.stringify(fixture.course)}, 'rm', '--cached', '-f', 'publish.yaml');
// Outside a captured snapshot, policy validation must see the current index immediately.
assert.throws(() => coursePolicies(${JSON.stringify(fixture.repo)}), /invalid or untracked/);
const note = ${JSON.stringify(path.join(fixture.course, 'notes/public.md'))};
fs.writeFileSync(note, '# Reported edit with an unreported policy index change');
await assert.rejects(prepareContent(false, new Set([note]), true), /invalid or untracked/);
assert(!fs.existsSync('build/generated/dev-state.json'));
git(${JSON.stringify(fixture.course)}, 'add', 'publish.yaml');
await prepareContent(false, undefined, true);
assert.equal(manifest().pages['sp99-cs101/notes/public'].publication.public, true);
assert(fs.readFileSync('build/generated/pages/sp99-cs101/notes/public.json', 'utf8').includes('Reported edit'));
console.log('missed policy reconciliation passed');
`
			],
			{
				cwd: site,
				env: {
					...process.env,
					TWIKI_PROJECT_ROOT: fixture.repo,
					TWIKI_CONFIG_FILE: path.join(fixture.repo, 'twiki.config.json'),
					TWIKI_CONTENT_DIR: path.join(fixture.repo, 'content'),
					VITE_PUBLIC_EDITION: 'true'
				},
				encoding: 'utf8',
				maxBuffer: 4 * 1024 * 1024,
				timeout: 25000
			}
		);
		expect(output).toContain('missed policy reconciliation passed');
	} finally {
		rmSync(fixture.repo, { recursive: true, force: true });
	}
}, 30000);

for (const publicEdition of [false, true]) {
	test(`note emission keeps raw downloads current and repairs unrelated outputs (${publicEdition ? 'public' : 'full'})`, () => {
		const fixture = publicationFixture();
		const site = path.join(fixture.repo, 'site');
		fixture.write(
			'twiki.config.json',
			JSON.stringify({
				version: 1,
				contentDir: 'content',
				discovery: 'git',
				publication: 'policies'
			})
		);
		try {
			prepareSite(site);
			const output = execFileSync(
				'bun',
				[
					'-e',
					`
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { prepareContent } from './tooling/pipeline';
import { contentInputFingerprint, contentOutputFingerprint } from './tooling/lib/dev-state';
import { staticDirectory, courseFilesDirectory, compiledAssetsDirectory } from './tooling/lib/edition-paths.js';
import { textExportUrl } from './src/lib/text-exports';
import { OutputCheckpoint } from './tooling/lib/output-checkpoint';
let checks = 0;
const checkOutputs = OutputCheckpoint.prototype.matchesCurrent;
OutputCheckpoint.prototype.matchesCurrent = function () { checks++; return checkOutputs.call(this); };
// Keep the source worker active while testing output repair in a small fixture.
Object.defineProperty(OutputCheckpoint.prototype, 'fileCount', { configurable: true, get: () => 32768 });
const source = ${JSON.stringify(path.join(fixture.course, 'notes/public.md'))};
const original = fs.readFileSync(source, 'utf8');
const image = ${JSON.stringify(path.join(fixture.course, 'notes/figure.svg'))};
const staticRoot = staticDirectory(process.cwd());
const indexFile = path.join(courseFilesDirectory(process.cwd()), 'index/sp99-cs101.json');
const files = () => JSON.parse(fs.readFileSync(indexFile, 'utf8'));
const download = (name) => path.join(staticRoot, files().find(file => file.path === name).download.slice(1));
const text = (slug, format) => path.join(staticRoot, textExportUrl(slug, format).slice(1));
const realLog = console.log;
let passes = 0;
console.log = (...args) => { if (String(args[0]).startsWith('content pipeline:')) passes++; realLog(...args); };
await prepareContent(false, undefined, true);
async function edit(label, expectedPasses, body = original) {
  const before = passes;
  fs.writeFileSync(source, body + '\\n\\n' + label + '\\n');
  await prepareContent(false, new Set([source]), true);
  assert.equal(passes - before, expectedPasses, label);
  assert.equal(fs.readFileSync(download('notes/public.md'), 'utf8'), fs.readFileSync(source, 'utf8'));
  for (const format of ['md', 'txt']) assert(fs.readFileSync(text('sp99-cs101/notes/public', format), 'utf8').includes(label));
  const saved = JSON.parse(fs.readFileSync('build/generated/dev-state.json', 'utf8'));
  assert.equal(saved.inputs, await contentInputFingerprint(${JSON.stringify(fixture.repo)}, process.env.TWIKI_PREPARED_CONTENT_KEY));
  assert.equal(saved.outputs, contentOutputFingerprint(process.cwd()));
}
await edit('Ordinary prose edit', 1);
// Narrowed builds must repair omissions even though icon generation is deferred.
const icons = path.join(courseFilesDirectory(process.cwd()), 'icons');
const iconName = fs.readdirSync(icons).find(name => name.endsWith('.svg'));
assert(iconName);
const icon = path.join(icons, iconName);
const staticIcon = path.join(staticRoot, '_files/icons', iconName);
const iconBytes = fs.readFileSync(icon);
fs.rmSync(icon);
fs.rmSync(staticIcon);
await edit('Repair missing unchanged icons', 2);
assert.deepEqual(fs.readFileSync(icon), iconBytes);
assert.deepEqual(fs.readFileSync(staticIcon), iconBytes);
const iconMetadata = 'src/lib/generated/file-icons.json';
const metadataBytes = fs.readFileSync(iconMetadata);
fs.rmSync(iconMetadata);
await edit('Repair missing icon metadata', 1);
assert.deepEqual(fs.readFileSync(iconMetadata), metadataBytes);
// Unexpected file names must trigger full pruning, never become trusted outputs.
const unexpectedPage = 'build/generated/pages/unexpected.json';
const unexpectedAsset = path.join(compiledAssetsDirectory(process.cwd()), 'unexpected.svg');
fs.writeFileSync(unexpectedPage, '{"unexpected":true}');
fs.writeFileSync(unexpectedAsset, '<svg>unexpected</svg>');
await edit('Prune unexpected generated names', 2);
assert(!fs.existsSync(unexpectedPage));
assert(!fs.existsSync(unexpectedAsset));

const otherDocument = 'build/generated/pages/sp99-cs101/notes/second.json';
const originalDocument = fs.readFileSync(otherDocument);
fs.writeFileSync(otherDocument, '{"corrupted":true}');
await edit('Repair an unchanged document alone', 2);
assert.deepEqual(fs.readFileSync(otherDocument), originalDocument);
// These outputs are unrelated to the reported edit and absent from its changed set.
const staticImage = path.join(staticRoot, 'sp99-cs101/notes/figure.svg');
fs.writeFileSync(staticImage, '<svg>corrupted generated image</svg>');
fs.rmSync(text('sp99-cs101/notes/second', 'txt'));
fs.rmSync(download('notes/second.md'));
fs.writeFileSync(otherDocument, '{"corrupted":true}');
await edit('Repair unrelated outputs', 2);
assert.deepEqual(fs.readFileSync(otherDocument), originalDocument);
// The deferred size check may reject this candidate, but a full pass must repair it.
fs.writeFileSync(otherDocument, Buffer.alloc(26 * 1024 * 1024));
await edit('Repair oversized generated document', 1);
assert.deepEqual(fs.readFileSync(otherDocument), originalDocument);
assert.equal(fs.readFileSync(staticImage, 'utf8'), fs.readFileSync(image, 'utf8'));
assert(fs.readFileSync(text('sp99-cs101/notes/second', 'txt'), 'utf8').includes('Another public explanation'));
assert.equal(fs.readFileSync(download('notes/second.md'), 'utf8'), fs.readFileSync(${JSON.stringify(path.join(fixture.course, 'notes/second.md'))}, 'utf8'));
// Source hints must never replace the independent fresh source validation.
fs.writeFileSync(image, '<svg>unreported source image edit</svg>');
await edit('Reported note alongside an unreported image edit', 2);
assert.equal(fs.readFileSync(staticImage, 'utf8'), fs.readFileSync(image, 'utf8'));
const beforeChecks = checks;
await edit('Catalog tag changes', 1, original.replace('tags: [practice]', 'tags: [practice, emission-test]'));
assert.equal(checks, beforeChecks, 'full emission must not also scan all outputs through the deferred path');
console.log('note emission and repair verified');
`
				],
				{
					cwd: site,
					env: {
						...process.env,
						TWIKI_PROJECT_ROOT: fixture.repo,
						TWIKI_CONFIG_FILE: path.join(fixture.repo, 'twiki.config.json'),
						TWIKI_CONTENT_DIR: path.join(fixture.repo, 'content'),
						VITE_PUBLIC_EDITION: String(publicEdition)
					},
					encoding: 'utf8',
					maxBuffer: 4 * 1024 * 1024,
					timeout: 45000
				}
			);
			expect(output).toContain('note emission and repair verified');
		} finally {
			rmSync(fixture.repo, { recursive: true, force: true });
		}
	}, 60000);
}
