import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const directories = ['src', 'tooling', 'worker', 'assets'];
const configFiles = [
	'package.json',
	'bun.lock',
	'svelte.config.js',
	'vite.config.ts',
	'tsconfig.json',
	'wrangler.jsonc',
	'_headers',
	'_redirects'
];
// Bun can load these before Vite starts. Include every supported mode so a
// copied dotenv file changing during an isolated build invalidates its snapshot.
const environmentFiles = [
	'.env',
	'.env.local',
	'.env.production',
	'.env.production.local',
	'.env.development',
	'.env.development.local',
	'.env.test',
	'.env.test.local'
];

/**
 * Identify application code, independent of checkout paths and course revisions.
 * Generated navigation and file icon catalogs are loaded as separate modules,
 * so course catalog changes do not change the application bundle's version.
 * @param {string} site
 * @param {NodeJS.ProcessEnv} environment
 */
export function applicationVersion(site, environment = process.env) {
	// Isolated edition snapshots use the canonical maintained-source inventory.
	const snapshotVersion = environment.WISCONSIN_APPLICATION_VERSION;
	if (snapshotVersion !== undefined) {
		if (!/^[a-f0-9]{64}$/.test(snapshotVersion))
			throw new Error('WISCONSIN_APPLICATION_VERSION must be a SHA-256 application version');
		return snapshotVersion;
	}
	const files = new Set(configFiles);
	/** @param {string} relative */
	function walk(relative) {
		if (!existsSync(path.join(site, relative))) return;
		for (const entry of readdirSync(path.join(site, relative), { withFileTypes: true })) {
			if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
			const file = `${relative}/${entry.name}`;
			if (file === 'src/lib/generated') continue;
			if (entry.isDirectory()) walk(file);
			else if (entry.isFile()) files.add(file);
		}
	}
	for (const directory of directories) walk(directory);
	// These maintained assets are also present in Git-free content-test copies.
	files.add('static/.gitignore');
	files.add('static/favicon.png');
	walk('static/fonts');
	try {
		// Respect static/.gitignore: synced course blobs must not change the app
		// version, while any additional maintained static asset should change it.
		for (const file of execFileSync(
			'git',
			['-C', site, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'static'],
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
		).split('\0')) {
			if (file) files.add(file);
		}
	} catch {
		// Scratch copies intentionally have no Git metadata.
	}
	for (const file of environmentFiles) if (existsSync(path.join(site, file))) files.add(file);
	const compileEnvironment = Object.entries(environment)
		.filter(
			([key]) =>
				key === 'NODE_ENV' ||
				((key.startsWith('VITE_') || key.startsWith('PUBLIC_')) && key !== 'VITE_PUBLIC_EDITION')
		)
		.sort(([a], [b]) => a.localeCompare(b));
	const hash = createHash('sha256').update(JSON.stringify(['site-app-v1', compileEnvironment]));
	for (const file of [...files].sort()) {
		const absolute = path.join(site, file);
		if (!existsSync(absolute)) continue;
		const bytes = readFileSync(absolute);
		hash.update(JSON.stringify([file, bytes.length])).update(bytes);
	}
	return hash.digest('hex');
}
