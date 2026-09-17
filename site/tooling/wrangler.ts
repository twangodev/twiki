import { spawn } from 'node:child_process';
import path from 'node:path';
import { prepareWranglerPaths } from './wrangler-paths.js';

const site = path.resolve(import.meta.dirname, '..');
const directory = prepareWranglerPaths(site);
const child = spawn('bunx', ['wrangler', ...process.argv.slice(2)], {
	cwd: site,
	stdio: 'inherit',
	env: { ...process.env, WRANGLER_CACHE_DIR: path.join(directory, 'cache') }
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
	console.error(error);
	process.exitCode = 1;
});
child.on('exit', (code) => {
	process.exitCode = code ?? 1;
});
