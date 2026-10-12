import { chromium } from '@playwright/test';

/** Tooling browsers use the OS font configuration, independently of the parent editor. */
export function launchBrowser(environment: NodeJS.ProcessEnv = process.env) {
	const env = { ...environment };
	for (const key of ['FONTCONFIG_FILE', 'FONTCONFIG_PATH', 'FONTCONFIG_SYSROOT']) delete env[key];
	return chromium.launch({
		env: Object.fromEntries(
			Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)
		)
	});
}
