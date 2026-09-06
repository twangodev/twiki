import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { rmSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { publicationFixture } from './publication-fixture';

const fixture = publicationFixture();
const port = process.env.TEST_PORT ?? '4188';
const origin = `http://127.0.0.1:${port}`;
let output = '';
const server = spawn(
	'bun',
	['x', 'vite', 'dev', '--host', '127.0.0.1', '--port', port, '--strictPort'],
	{
		env: { ...process.env, WISCONSIN_CONTENT_REPO: fixture.repo, VITE_PUBLIC_EDITION: 'true' },
		stdio: ['ignore', 'pipe', 'pipe']
	}
);
server.stdout.on('data', (chunk) => {
	output += chunk;
});
server.stderr.on('data', (chunk) => {
	output += chunk;
});
const stopped = new Promise<void>((resolve) => server.once('exit', () => resolve()));
const browser = await chromium.launch();

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
		async () => (await fetch(origin + '/sp99-cs101/notes/public')).ok,
		'fresh dev startup'
	);
	const page = await browser.newPage();
	await page.goto(origin + '/sp99-cs101/notes/public');
	await until(
		async () => (await page.locator('article').innerText()).includes('publicsearchcanary'),
		'initial note'
	);
	fixture.write(
		'content/sp99-cs101/notes/public.md',
		fixture.publicNote + '\nLive content update.\n'
	);
	await until(
		async () => (await page.locator('article').innerText()).includes('Live content update.'),
		'automatic browser refresh'
	);
	fixture.write('content/sp99-cs101/notes/public.md', fixture.publicNote + '\n![[slides]]\n');
	await until(
		async () => (await fetch(origin + '/sp99-cs101/notes/public')).status === 500,
		'failed rebuild blocks incomplete output'
	);
	fixture.write('content/sp99-cs101/notes/public.md', fixture.publicNote);
	await until(
		async () => (await fetch(origin + '/sp99-cs101/notes/public')).ok,
		'recovery after a failed rebuild'
	);
	fixture.write('content/sp99-cs101/notes/new.md', '# Newly tracked note\n\nNew note body.');
	execFileSync('git', ['-C', path.join(fixture.repo, 'content/sp99-cs101'), 'add', 'notes/new.md']);
	await until(
		async () => (await fetch(origin + '/sp99-cs101/notes/new')).ok,
		'tracked note addition'
	);
	unlinkSync(path.join(fixture.repo, 'content/sp99-cs101/notes/new.md'));
	await until(
		async () => (await fetch(origin + '/sp99-cs101/notes/new')).status === 404,
		'note deletion'
	);
	fixture.write('content/sp99-cs101/publish.yaml', 'include: []\n');
	await until(
		async () => (await page.locator('article').innerText()).includes('Content locked'),
		'publication revocation'
	);
	if ((await page.locator('article').innerText()).includes('publicsearchcanary'))
		throw new Error('Revoked note still contains private content');
	console.log(
		'Content dev integration passed: startup, refresh, failure recovery, add, delete, revoke'
	);
} finally {
	await browser.close();
	server.kill('SIGTERM');
	await stopped;
	rmSync(fixture.repo, { recursive: true, force: true });
}
