import { defineConfig, devices } from '@playwright/test';

const baseURL = `http://127.0.0.1:${process.env.TEST_PORT ?? '4174'}`;

export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: true,
	workers: 2,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL,
		storageState: '.generated/auth-state.json',
		colorScheme: 'light',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	webServer: {
		command: 'bun tests/preview.ts',
		url: `${baseURL}/login`,
		reuseExistingServer: false,
		timeout: 120_000
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	]
});
