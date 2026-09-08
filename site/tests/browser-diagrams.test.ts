import { test, expect } from 'bun:test';
import { chromium } from '@playwright/test';
import { checkMermaid, mermaidPage } from '../tooling/check-diagrams';

test('renders real Mermaid and rejects invalid syntax', async () => {
	const browser = await chromium.launch();
	try {
		const page = await mermaidPage(browser);
		await checkMermaid(page, 'graph TD\n%% first comment\nA --> B\n%% second comment\nB --> C');
		await checkMermaid(page, 'sequenceDiagram\nAlice->>Bob: Hello');
		await expect(checkMermaid(page, 'graph TD\nA — holds --> B')).rejects.toThrow();
	} finally {
		await browser.close();
	}
}, 30_000);
