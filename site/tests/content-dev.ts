import { chromium, type Page } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import {
	rmSync,
	existsSync,
	unlinkSync,
	statSync,
	utimesSync,
	cpSync,
	readFileSync,
	realpathSync,
	renameSync,
	writeFileSync,
	mkdtempSync,
	mkdirSync,
	symlinkSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { publicationFixture } from './publication-fixture';
import { nestedPublicationFixture } from './nested-publication-fixture';

const started = performance.now();
const fixture = publicationFixture();
const { nested, git } = nestedPublicationFixture(fixture);
fixture.write(
	'content/sp99-cs101/publish.yaml',
	readFileSync(path.join(fixture.course, 'publish.yaml'), 'utf8').replace(
		'include:\n',
		'include:\n  - projects/nested.md\n'
	)
);
fixture.write('content/sp99-cs101/notes/worksheet.Rmd', '# Lazy worksheet\n\n```{r}\n1 + 1\n```\n');
execFileSync('git', ['-C', fixture.course, 'add', 'notes/worksheet.Rmd']);
const isolated = mkdtempSync(path.join(tmpdir(), 'wisconsin-content-dev-'));
const source = path.resolve(import.meta.dirname, '..');
const siteDirectory = path.join(isolated, 'site');
const excluded = new Set([
	'build',
	'.svelte-kit',
	'.wrangler',
	'node_modules',
	'static',
	'src/lib/generated',
	'test-results',
	'playwright-report'
]);
cpSync(source, siteDirectory, {
	recursive: true,
	filter: (file) => !excluded.has(path.relative(source, file))
});
symlinkSync(
	path.resolve(source, '../node_modules'),
	path.join(siteDirectory, 'node_modules'),
	'dir'
);
// Merge the fixture's filesystem access with the real config, preserving its
// server settings (including watch ignores) without duplicate object keys.
const viteConfig = path.join(siteDirectory, 'vite.content-test.config.ts');
writeFileSync(
	viteConfig,
	`import { mergeConfig } from 'vite';
import config from './vite.config';
export default mergeConfig(config, {
  cacheDir: ${JSON.stringify(path.join(siteDirectory, 'build/.vite'))},
  server: { fs: { allow: ${JSON.stringify([siteDirectory, realpathSync(path.resolve(source, '../node_modules'))])} } }
});
`
);
mkdirSync(path.join(siteDirectory, 'static'));
for (const file of ['fonts', 'favicon.ico', '.gitignore'])
	cpSync(path.join(source, 'static', file), path.join(siteDirectory, 'static', file), {
		recursive: true
	});
const port = process.env.TEST_PORT ?? '4188';
const origin = `http://127.0.0.1:${port}`;
let output = '';
function startServer(publicEdition = true) {
	output = '';
	const server = spawn(
		'bun',
		[
			'x',
			'vite',
			'dev',
			'--config',
			viteConfig,
			'--host',
			'127.0.0.1',
			'--port',
			port,
			'--strictPort'
		],
		{
			cwd: siteDirectory,
			env: {
				...process.env,
				TWIKI_CONTENT_REPO: fixture.repo,
				VITE_PUBLIC_EDITION: String(publicEdition),
				RSCRIPT: path.join(isolated, 'missing-rscript'),
				R_REQUIRE_PROFILE: '0',
				R_CACHE_ONLY: '0'
			},
			stdio: ['ignore', 'pipe', 'pipe']
		}
	);
	server.stdout.on('data', (chunk) => {
		output += chunk;
		if (process.env.CONTENT_TEST_DEBUG) process.stderr.write(chunk);
	});
	server.stderr.on('data', (chunk) => {
		output += chunk;
		if (process.env.CONTENT_TEST_DEBUG) process.stderr.write(chunk);
	});
	const stopped = new Promise<void>((resolve) => server.once('exit', () => resolve()));
	return { server, stopped };
}
let { server, stopped } = startServer();
const browser = await chromium.launch();
async function restart(publicEdition = true) {
	server.kill('SIGTERM');
	await stopped;
	({ server, stopped } = startServer(publicEdition));
	await until(async () => (await fetch(origin + '/sp99-cs101/notes/public')).ok, 'restart');
}

async function until(check: () => Promise<boolean>, label: string) {
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		if (await check().catch(() => false)) return;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(`Timed out: ${label}\n${output}`);
}

async function contentData(page: Page, route: string) {
	const request = await page.waitForRequest(
		(request) => new URL(request.url()).pathname === `${route}/__data.json`
	);
	// Replay the exact invalidation mask: Chromium may discard preloaded or
	// superseded response bodies before Playwright can read them.
	const response = await fetch(request.url());
	return JSON.parse((await response.text()).split('\n')[0]) as { nodes: { type?: string }[] };
}

try {
	await until(
		async () =>
			(await fetch(origin + '/sp99-cs101/notes/public', { signal: AbortSignal.timeout(5000) })).ok,
		'fresh dev startup'
	);
	const initialPage = path.join(
		siteDirectory,
		'build/generated/pages/sp99-cs101/notes/public.json'
	);
	const initialTime = statSync(initialPage).mtimeMs;
	if (existsSync(path.join(siteDirectory, 'static/_og')))
		throw new Error('Dev startup eagerly rendered social images');
	const social = await fetch(origin + '/_og/notes/sp99-cs101/notes/public.png');
	if (
		!social.ok ||
		Buffer.from(await social.arrayBuffer())
			.subarray(0, 8)
			.toString('hex') !== '89504e470d0a1a0a'
	)
		throw new Error('On-demand social image failed');
	if ((await fetch(origin + '/_og/notes/missing.png')).status !== 404)
		throw new Error('Unknown social image did not return 404');

	await restart();
	if (!output.includes('reused saved output') || statSync(initialPage).mtimeMs !== initialTime)
		throw new Error(`Restart did not reuse output: ${output}`);
	console.log(output.match(/content startup: .*/)?.[0]);
	const pipelineCount = () => (output.match(/content pipeline:/g) ?? []).length;
	const reuseCount = () => (output.match(/reused saved output/g) ?? []).length;
	async function metadataReuse(change: () => void, label: string) {
		const pipelines = pipelineCount();
		const reused = reuseCount();
		change();
		await until(async () => reuseCount() > reused, label);
		if (!(await fetch(origin + '/sp99-cs101/notes/public')).ok)
			throw new Error(`${label} blocked existing content`);
		if (pipelineCount() !== pipelines || statSync(initialPage).mtimeMs !== initialTime)
			throw new Error(`${label} unnecessarily rebuilt content`);
	}
	await metadataReuse(
		() => git(fixture.repo, 'branch', 'unrelated-worktree'),
		'unrelated shared ref reuses content'
	);
	await metadataReuse(() => {
		// Refresh metadata on the actual index, leaving its tracked entries unchanged.
		const index = execFileSync(
			'git',
			['-C', fixture.repo, 'rev-parse', '--path-format=absolute', '--git-path', 'index'],
			{ encoding: 'utf8' }
		).trim();
		const now = new Date();
		utimesSync(index, now, now);
	}, 'no-op Git index event reuses content');
	server.kill('SIGTERM');
	await stopped;
	fixture.write(
		'content/sp99-cs101/projects/nested.md',
		'# Nested project\n\nOffline nested edit.'
	);
	({ server, stopped } = startServer());
	await until(
		async () =>
			(await (await fetch(origin + '/sp99-cs101/projects/nested')).text()).includes(
				'Offline nested edit.'
			),
		'offline nested edit on restart'
	);
	server.kill('SIGTERM');
	await stopped;
	git(fixture.course, 'config', 'submodule.projects.active', 'false');
	({ server, stopped } = startServer());
	await until(
		async () => (await fetch(origin + '/sp99-cs101/projects/nested')).status === 404,
		'offline nested unregistration removes stale output'
	);
	git(fixture.course, 'config', 'submodule.projects.active', 'true');
	await until(
		async () =>
			(await (await fetch(origin + '/sp99-cs101/projects/nested')).text()).includes(
				'Offline nested edit.'
			),
		'live nested registration restores output'
	);
	fixture.write('content/sp99-cs101/projects/added.md', '# Nested tracked addition\n');
	git(nested, 'add', 'added.md');
	await until(
		async () => (await fetch(origin + '/sp99-cs101/projects/added')).ok,
		'live nested index discovers tracked addition'
	);
	server.kill('SIGTERM');
	await stopped;
	fixture.write('content/sp99-cs101/notes/public.md', fixture.publicNote + '\nOffline edit.');
	({ server, stopped } = startServer());
	await until(
		async () =>
			(await (await fetch(origin + '/sp99-cs101/notes/public')).text()).includes('Offline edit.'),
		'offline edit on restart'
	);
	server.kill('SIGTERM');
	await stopped;
	rmSync(initialPage);
	({ server, stopped } = startServer());
	await until(
		async () => (await fetch(origin + '/sp99-cs101/notes/public')).ok && existsSync(initialPage),
		'missing output recovery'
	);
	if (
		(await fetch(origin + '/__content/history?course=sp99-cs101&file=notes/public.md')).status !==
		404
	)
		throw new Error('Public dev exposes history');
	const page = await browser.newPage();
	page.setDefaultTimeout(5000);
	page.on('pageerror', (error) => {
		output += `\nBrowser error: ${error.message}\n`;
	});
	await page.goto(origin + '/sp99-cs101/notes/public');
	await until(
		async () => (await page.locator('article').innerText()).includes('publicsearchcanary'),
		'initial note'
	);
	await until(async () => {
		await page.getByRole('button', { name: 'Use this note' }).click();
		return page.getByRole('dialog', { name: 'Note actions' }).isVisible();
	}, 'client hydration');
	await page.keyboard.press('Escape');
	for (const target of ['second', 'public']) {
		const route = `/sp99-cs101/notes/${target}`;
		const response = contentData(page, route);
		await page.locator(`article a[href="${route}"]`).first().click();
		const data = await response;
		if (data.nodes[0]?.type !== 'skip')
			throw new Error('Dev navigation downloaded the shared layout again');
		await page.waitForURL(origin + route);
	}
	const unchangedPath = path.join(
		siteDirectory,
		'build/generated/pages/sp99-cs101/notes/second.json'
	);
	const unchangedStat = statSync(unchangedPath);
	await page.evaluate(() => {
		(window as unknown as { contentTestMarker: string }).contentTestMarker = 'preserved';
	});
	const editStart = performance.now();
	const editedData = contentData(page, '/sp99-cs101/notes/public');
	// Editors commonly save a temporary file, then replace the original atomically.
	const temporaryNote = path.join(fixture.course, 'notes/.public.md.tmp');
	writeFileSync(
		temporaryNote,
		fixture.publicNote + '\nLive content update.\n\n```js\nconsole.log(1);\n```\n'
	);
	renameSync(temporaryNote, path.join(fixture.course, 'notes/public.md'));
	await until(
		async () => (await page.locator('article').innerText()).includes('Live content update.'),
		'automatic browser refresh'
	);
	const editedNodes = await editedData;
	if (editedNodes.nodes[0]?.type !== 'skip')
		throw new Error('Body edit downloaded unchanged layout data');
	await until(
		async () => (await page.getByRole('button', { name: 'Copy code', exact: true }).count()) === 1,
		'updated code block enhancement'
	);
	console.log(`Incremental edit visible in ${Math.round(performance.now() - editStart)}ms`);
	if (statSync(unchangedPath).mtimeMs !== unchangedStat.mtimeMs)
		throw new Error('Unrelated page was rewritten');
	if (
		(await page.evaluate(
			() => (window as unknown as { contentTestMarker?: string }).contentTestMarker
		)) !== 'preserved'
	)
		throw new Error('Content edit reloaded the browser');
	fixture.write('content/sp99-cs101/notes/public.md', fixture.publicNote + '\n![[slides]]\n');
	await until(
		async () =>
			(await fetch(origin + '/sp99-cs101/notes/public', { signal: AbortSignal.timeout(5000) }))
				.status === 500,
		'failed rebuild blocks incomplete output'
	);
	fixture.write('content/sp99-cs101/notes/public.md', fixture.publicNote);
	await until(
		async () =>
			(await fetch(origin + '/sp99-cs101/notes/public', { signal: AbortSignal.timeout(5000) })).ok,
		'recovery after a failed rebuild'
	);
	await until(
		async () => (await page.locator('vite-error-overlay').count()) === 0,
		'error overlay cleared'
	);
	const untrackedPipelines = pipelineCount();
	fixture.write('content/sp99-cs101/notes/new.md', '# Newly tracked note\n\nNew note body.');
	await until(
		async () => pipelineCount() > untrackedPipelines,
		'ordinary untracked file event still reconciles content'
	);
	if ((await fetch(origin + '/sp99-cs101/notes/new')).status !== 404)
		throw new Error('Untracked note bypassed authoritative Git discovery');
	execFileSync('git', ['-C', path.join(fixture.repo, 'content/sp99-cs101'), 'add', 'notes/new.md']);
	await until(
		async () =>
			(await fetch(origin + '/sp99-cs101/notes/new', { signal: AbortSignal.timeout(5000) })).ok,
		'tracked note addition'
	);
	await until(
		async () =>
			(await page.locator('aside.doc-sidebar-left a[href="/sp99-cs101/notes/new"]').count()) > 0,
		'added note appears in refreshed navigation'
	);
	if (statSync(unchangedPath).mtimeMs !== unchangedStat.mtimeMs)
		throw new Error('Adding a note rewrote an unrelated page');
	unlinkSync(path.join(fixture.repo, 'content/sp99-cs101/notes/new.md'));
	await until(
		async () =>
			(await fetch(origin + '/sp99-cs101/notes/new', { signal: AbortSignal.timeout(5000) }))
				.status === 404,
		'note deletion'
	);
	await until(
		async () =>
			(await page.locator('aside.doc-sidebar-left a[href="/sp99-cs101/notes/new"]').count()) === 0,
		'deleted note disappears from refreshed navigation'
	);
	fixture.write('content/sp99-cs101/notes/public.md', fixture.publicNote + '\n![[second]]\n');
	await until(
		async () => (await page.locator('article').innerText()).includes('Another public explanation.'),
		'transclusion'
	);
	fixture.write(
		'content/sp99-cs101/notes/second.md',
		'# Second derivation\n\nChanged embedded explanation.\n\n[[public]]'
	);
	await until(
		async () =>
			(await page.locator('article').innerText()).includes('Changed embedded explanation.'),
		'dependent transclusion refresh'
	);
	const tagPage = await browser.newPage();
	await tagPage.goto(origin + '/tags');
	await until(
		async () => tagPage.locator('button[aria-label="Toggle navigation"]').isEnabled(),
		'tag index hydration'
	);
	fixture.write(
		'content/sp99-cs101/notes/public.md',
		fixture.publicNote.replace('tags: [practice]', 'tags: [practice, live-tag]') + '\n![[second]]\n'
	);
	await until(
		async () => (await tagPage.locator('a[href="/tags/live-tag"]').count()) > 0,
		'tag index refresh without layout invalidation'
	);
	await tagPage.close();
	fixture.write('content/sp99-cs101/publish.yaml', 'include: []\n');
	await until(
		async () => (await page.locator('article').innerText()).includes('Content locked'),
		'publication revocation'
	);
	if ((await page.locator('article').innerText()).includes('publicsearchcanary'))
		throw new Error('Revoked note still contains private content');
	await page.close();
	await restart(false);
	if (
		existsSync(path.join(siteDirectory, 'build/generated/dev-history/history')) ||
		existsSync(path.join(siteDirectory, 'build/generated/assets/_files/history'))
	)
		throw new Error('Dev startup eagerly built history');
	const historyResponse = await fetch(
		origin + '/__content/history?course=sp99-cs101&file=p01/Main.java'
	);
	if (!historyResponse.ok) throw new Error('Lazy history failed');
	const history = await historyResponse.json();
	if (!history.commits.length || !(await fetch(origin + history.blame)).ok)
		throw new Error('Lazy history or blame unavailable');
	for (const file of ['../.git/config', '.env', 'untracked.java'])
		if (
			(
				await fetch(
					origin + '/__content/history?course=sp99-cs101&file=' + encodeURIComponent(file)
				)
			).status !== 404
		)
			throw new Error('History exposed excluded path');

	const noteHistory = await (
		await fetch(origin + '/__content/history?course=sp99-cs101&file=notes/public.md')
	).json();
	const diff = noteHistory.commits.find((commit: { diff?: string }) => commit.diff)?.diff;
	if (!diff || !(await fetch(origin + diff)).ok) throw new Error('Lazy history diff unavailable');
	const filePage = await browser.newPage();
	filePage.setDefaultTimeout(5000);
	await filePage.goto(origin + '/sp99-cs101/files/p01/Main.java');
	await until(async () => {
		const panel = filePage.getByRole('complementary', { name: 'File history' });
		if (!(await panel.isVisible()))
			await filePage.getByRole('button', { name: 'File history', exact: true }).click();
		return (await panel.innerText()).includes('Publish selected current files');
	}, 'history panel after client hydration');
	await filePage.evaluate(() => {
		(window as unknown as { contentTestMarker: string }).contentTestMarker = 'preserved';
	});
	fixture.write('content/sp99-cs101/p01/Main.java', 'class Main { int changed; }\n');
	await until(
		async () =>
			(await filePage.getByRole('complementary', { name: 'File history' }).innerText()).includes(
				'Working copy differs'
			),
		'history refresh after local edit'
	);
	if (
		(await filePage.evaluate(
			() => (window as unknown as { contentTestMarker?: string }).contentTestMarker
		)) !== 'preserved'
	)
		throw new Error('File edit reloaded the browser');
	let releasePreview!: () => void;
	const previewPending = new Promise<void>((resolve) => {
		releasePreview = resolve;
	});
	await filePage.route('**/__content/rmd?*', async (route) => {
		await previewPending;
		await route.fulfill({
			json: { title: 'Lazy rendered worksheet', html: '<p>Selected computed result</p>' }
		});
	});
	await filePage.goto(origin + '/sp99-cs101/files/notes/worksheet.Rmd');
	await filePage.getByText('Rendering worksheet…', { exact: true }).waitFor({ timeout: 30000 });
	if (!(await filePage.getByRole('button', { name: 'Source', exact: true }).isEnabled()))
		throw new Error('Slow R rendering blocked worksheet controls');
	releasePreview();
	await filePage
		.getByRole('article', { name: 'Rendered worksheet' })
		.getByText('Selected computed result')
		.waitFor();
	await filePage.unroute('**/__content/rmd?*');
	await filePage.reload();
	await until(
		async () => (await filePage.locator('.cm-content').innerText()).includes('Lazy worksheet'),
		'lazy worksheet Source fallback without R'
	);
	await filePage.close();
	await restart(false);
	if (!output.includes('reused saved output'))
		throw new Error('Lazy history invalidated startup cache');
	console.log(
		`Content dev integration passed: restart reuse, offline edits, missing output, lazy history, lazy worksheet fallback, refresh, failure recovery, add, delete, revoke (${((performance.now() - started) / 1000).toFixed(2)}s)`
	);
} finally {
	await browser.close();
	server.kill('SIGTERM');
	await stopped;
	rmSync(fixture.repo, { recursive: true, force: true });
	rmSync(isolated, { recursive: true, force: true });
}
