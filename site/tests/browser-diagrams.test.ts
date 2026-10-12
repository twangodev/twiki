import { test, expect } from 'bun:test';
import { chromium } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkMermaid, mermaidBrowser, mermaidPage } from '../tooling/check-diagrams';

test('renders real Mermaid and rejects invalid syntax', async () => {
	const { browser, page } = await mermaidBrowser();
	try {
		await checkMermaid(page, 'graph TD\n%% first comment\nA --> B\n%% second comment\nB --> C');
		await checkMermaid(page, 'sequenceDiagram\nAlice->>Bob: Hello');
		await expect(checkMermaid(page, 'graph TD\nA — holds --> B')).rejects.toThrow();
	} finally {
		await browser.close();
	}
}, 30_000);

test.skipIf(process.platform !== 'linux')(
	'recovers from an inherited font configuration with no fonts',
	async () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'twiki-browser-fonts-'));
		const file = path.join(directory, 'fonts.conf');
		writeFileSync(file, '<?xml version="1.0"?><fontconfig></fontconfig>');
		const environment = { ...process.env, FONTCONFIG_PATH: directory, FONTCONFIG_FILE: file };
		const initialEnvironment = { ...environment };
		let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
		try {
			browser = await chromium.launch({ env: environment });
			await expect(mermaidPage(browser)).rejects.toThrow('Chromium cannot measure SVG text');
			await browser.close();
			browser = undefined;
			const started = await mermaidBrowser(environment);
			browser = started.browser;
			expect(started.usedSystemFontConfig).toBe(true);
			expect(environment).toEqual(initialEnvironment);
			await checkMermaid(
				started.page,
				'classDiagram\nclass Iterator {\n<<interface>>\n+next() Object\n}'
			);
			await checkMermaid(
				started.page,
				'sequenceDiagram\nparticipant A\nNote over A: Process running\nA->>A: Context switch'
			);
			await expect(checkMermaid(started.page, 'graph TD\nA — holds --> B')).rejects.toThrow();
		} finally {
			await browser?.close();
			rmSync(directory, { recursive: true, force: true });
		}
	},
	30_000
);

test.skipIf(process.platform !== 'linux')(
	'keeps a working custom font configuration',
	async () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'twiki-browser-fonts-'));
		const file = path.join(directory, 'fonts.conf');
		writeFileSync(
			file,
			'<?xml version="1.0"?><fontconfig><include>/etc/fonts/fonts.conf</include></fontconfig>'
		);
		let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
		try {
			const started = await mermaidBrowser({
				...process.env,
				FONTCONFIG_PATH: directory,
				FONTCONFIG_FILE: file
			});
			browser = started.browser;
			expect(started.usedSystemFontConfig).toBe(false);
			await checkMermaid(
				started.page,
				'sequenceDiagram\nparticipant A\nNote over A: Working fonts'
			);
		} finally {
			await browser?.close();
			rmSync(directory, { recursive: true, force: true });
		}
	},
	30_000
);
