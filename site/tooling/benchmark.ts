import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { availableParallelism, cpus, totalmem } from 'node:os';
import path from 'node:path';

const [mode, requestedLabel] = process.argv.slice(2);
if (mode !== 'build' && mode !== 'dev') {
	console.error('Usage: bun tooling/benchmark.ts <build|dev> [label]');
	process.exit(2);
}
const label = requestedLabel ?? `${mode}-${new Date().toISOString().replaceAll(':', '-')}`;
if (!/^[\w.-]+$/.test(label) || label === '.' || label === '..') {
	throw new Error('Label must contain only letters, numbers, underscores, dots, or hyphens');
}
const timeoutSeconds = Number(process.env.BENCHMARK_TIMEOUT_SECONDS ?? '300');
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
	throw new Error('BENCHMARK_TIMEOUT_SECONDS must be positive');
}
const site = path.resolve(import.meta.dirname, '..');
const directory = path.join(site, 'build/benchmarks');
mkdirSync(directory, { recursive: true });
const logPath = path.join(directory, `${label}.log`);
const resultPath = path.join(directory, `${label}.json`);
const log = createWriteStream(logPath);
const nodeRuntime = spawnSync('node', ['--version'], { encoding: 'utf8', timeout: 5000 });
const actualNodeVersion = nodeRuntime.status === 0 ? nodeRuntime.stdout.trim() : undefined;
const started = performance.now();
const elapsed = () => Math.round((performance.now() - started) / 10) / 100;

async function freePort() {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('No benchmark port allocated');
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve()))
	);
	return address.port;
}

const port = mode === 'dev' ? await freePort() : undefined;
const args =
	mode === 'build'
		? ['run', 'build:all']
		: ['run', 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
const command = process.versions.bun ? process.execPath : 'bun';
const child = spawn(command, args, {
	cwd: site,
	env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
	detached: process.platform !== 'win32',
	stdio: ['ignore', 'pipe', 'pipe']
});
let readySeconds: number | undefined;
let httpSeconds: number | undefined;
let failure: string | undefined;
let closed = false;
let exitCode: number | null = null;
let exitSignal: string | null = null;
let tail = '';
for (const stream of [child.stdout, child.stderr]) {
	stream.on('data', (chunk: Buffer) => {
		log.write(chunk);
		process.stdout.write(chunk);
		tail = (tail + chunk.toString()).slice(-4096);
		if (
			mode === 'dev' &&
			readySeconds === undefined &&
			/\bready in\s+[\d.]+\s*(?:ms|s)/.test(tail)
		) {
			readySeconds = elapsed();
		}
	});
}
const completion = new Promise<void>((resolve) => {
	child.on('error', (error) => {
		failure = error.message;
	});
	child.on('close', (code, signal) => {
		closed = true;
		exitCode = code;
		exitSignal = signal;
		resolve();
	});
});
function stop() {
	if (!child.pid) return;
	try {
		if (process.platform === 'win32') child.kill('SIGTERM');
		else process.kill(-child.pid, 'SIGTERM');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
	}
}
function interrupt() {
	failure = 'Benchmark interrupted';
	gracefulStop();
}
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
const timeout = setTimeout(() => {
	failure = `Timed out after ${timeoutSeconds}s`;
	gracefulStop();
}, timeoutSeconds * 1000);
let killTimeout: ReturnType<typeof setTimeout> | undefined;
function gracefulStop() {
	if (killTimeout) return;
	stop();
	killTimeout = setTimeout(() => {
		if (!child.pid) return;
		try {
			if (process.platform === 'win32') child.kill('SIGKILL');
			else process.kill(-child.pid, 'SIGKILL');
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
		}
	}, 2000);
}
try {
	if (mode === 'dev') {
		while (!closed && !failure && httpSeconds === undefined) {
			try {
				const response = await fetch(`http://127.0.0.1:${port}/`, {
					signal: AbortSignal.timeout(2000),
					redirect: 'manual'
				});
				const html = await response.text();
				if (
					response.status === 200 &&
					response.headers.get('content-type')?.includes('text/html') &&
					/<h1\b[^>]*>[\s\S]*?wisconsin[\s\S]*?<\/h1>/i.test(html) &&
					html.includes('My course notes from UW')
				) {
					httpSeconds = elapsed();
				}
			} catch {
				/* The server may still be compiling or binding its port. */
			}
			if (httpSeconds === undefined) await new Promise((resolve) => setTimeout(resolve, 100));
		}
		if (httpSeconds === undefined && !failure)
			failure = 'Dev server exited before serving the expected home page';
		gracefulStop();
	}
	await completion;
	if (mode === 'build' && exitCode !== 0 && !failure)
		failure = `Build exited with ${exitCode ?? exitSignal}`;
} finally {
	clearTimeout(timeout);
	if (killTimeout) clearTimeout(killTimeout);
	process.removeListener('SIGINT', interrupt);
	process.removeListener('SIGTERM', interrupt);
	await new Promise<void>((resolve) => log.end(resolve));
}
const result = {
	label,
	mode,
	recordedAt: new Date().toISOString(),
	command: [command, ...args],
	seconds: elapsed(),
	readySeconds,
	firstHttp200Seconds: httpSeconds,
	exitCode,
	exitSignal,
	success: !failure,
	failure,
	host: {
		platform: process.platform,
		architecture: process.arch,
		bun: process.versions.bun,
		nodeCompatibilityVersion: process.versions.node,
		actualNodeVersion,
		cpu: cpus()[0]?.model,
		availableCpus: availableParallelism(),
		memoryBytes: totalmem()
	},
	logPath
};
writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n');
console.log(`Benchmark saved: ${resultPath}`);
console.log(JSON.stringify(result, null, 2));
if (failure) process.exitCode = 1;
