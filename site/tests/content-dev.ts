import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import {
	rmSync,
	existsSync,
	unlinkSync,
	statSync,
	cpSync,
	readFileSync,
	realpathSync,
	writeFileSync,
	mkdtempSync,
	mkdirSync,
	symlinkSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { publicationFixture } from './publication-fixture';

const fixture = publicationFixture();
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
symlinkSync(path.join(source, 'node_modules'), path.join(siteDirectory, 'node_modules'), 'dir');
// Merge the fixture's filesystem access with the real config, preserving its
// server settings (including watch ignores) without duplicate object keys.
const viteConfig = path.join(siteDirectory, 'vite.content-test.config.ts');
writeFileSync(
	viteConfig,
	`import { mergeConfig } from 'vite';
import config from './vite.config';
export default mergeConfig(config, {
  server: { fs: { allow: ${JSON.stringify([siteDirectory, realpathSync(path.join(source, 'node_modules'))])} } }
});
`
);
mkdirSync(path.join(siteDirectory, 'static'));
for (const file of ['fonts', 'favicon.png', '.gitignore'])
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
				WISCONSIN_CONTENT_REPO: fixture.repo,
				VITE_PUBLIC_EDITION: String(publicEdition)
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
	const unchangedPath = path.join(
		siteDirectory,
		'build/generated/pages/sp99-cs101/notes/second.json'
	);
	const unchangedStat = statSync(unchangedPath);
	await page.evaluate(() => {
		(window as unknown as { contentTestMarker: string }).contentTestMarker = 'preserved';
	});
	const editStart = performance.now();
	fixture.write(
		'content/sp99-cs101/notes/public.md',
		fixture.publicNote + '\nLive content update.\n\n```js\nconsole.log(1);\n```\n'
	);
	await until(
		async () => (await page.locator('article').innerText()).includes('Live content update.'),
		'automatic browser refresh'
	);
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
	fixture.write('content/sp99-cs101/notes/new.md', '# Newly tracked note\n\nNew note body.');
	execFileSync('git', ['-C', path.join(fixture.repo, 'content/sp99-cs101'), 'add', 'notes/new.md']);
	await until(
		async () =>
			(await fetch(origin + '/sp99-cs101/notes/new', { signal: AbortSignal.timeout(5000) })).ok,
		'tracked note addition'
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
	fixture.write('content/sp99-cs101/p01/Main.java', 'class Main { int changed; }\n');
	await until(
		async () =>
			(await filePage.getByRole('complementary', { name: 'File history' }).innerText()).includes(
				'Working copy differs'
			),
		'history refresh after local edit'
	);
	await filePage.close();
	await restart(false);
	if (!output.includes('reused saved output'))
		throw new Error('Lazy history invalidated startup cache');
	console.log(
		'Content dev integration passed: restart reuse, offline edits, missing output, lazy history, refresh, failure recovery, add, delete, revoke'
	);
} finally {
	await browser.close();
	server.kill('SIGTERM');
	await stopped;
	rmSync(fixture.repo, { recursive: true, force: true });
	rmSync(isolated, { recursive: true, force: true });
}
