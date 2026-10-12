import { test, expect } from 'bun:test';
import type { Browser } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkMermaid, mermaidPage } from '../../tooling/check-diagrams';
import { launchBrowser } from '../../tooling/lib/browser';

test('renders real Mermaid and rejects invalid syntax', async () => {
	const browser = await launchBrowser();
	try {
		const page = await mermaidPage(browser);
		await checkMermaid(page, 'graph TD\n%% first comment\nA --> B\n%% second comment\nB --> C');
		await checkMermaid(page, 'sequenceDiagram\nAlice->>Bob: Hello');
		await expect(checkMermaid(page, 'graph TD\nA — holds --> B')).rejects.toThrow();
	} finally {
		await browser.close();
	}
}, 30_000);

test('browser rendering is independent of inherited Fontconfig overrides', async () => {
	const directory = mkdtempSync(path.join(tmpdir(), 'twiki-browser-fonts-'));
	const file = path.join(directory, 'fonts.conf');
	writeFileSync(file, '<?xml version="1.0"?><fontconfig></fontconfig>');
	const environment = {
		...process.env,
		FONTCONFIG_PATH: directory,
		FONTCONFIG_FILE: file,
		FONTCONFIG_SYSROOT: directory
	};
	const initialEnvironment = { ...environment };
	let browser: Browser | undefined;
	try {
		browser = await launchBrowser(environment);
		const page = await mermaidPage(browser);
		await checkMermaid(page, 'classDiagram\nclass Iterator {\n<<interface>>\n+next() Object\n}');
		await checkMermaid(
			page,
			'sequenceDiagram\nparticipant A\nNote over A: Process running\nA->>A: Context switch'
		);
		expect(environment).toEqual(initialEnvironment);
	} finally {
		await browser?.close();
		rmSync(directory, { recursive: true, force: true });
	}
}, 30_000);
