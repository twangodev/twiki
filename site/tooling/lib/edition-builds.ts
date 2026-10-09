import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import path from 'node:path';

export type BuildMode = 'serial' | 'parallel' | 'isolated-serial';

export function buildMode(value = process.env.WISCONSIN_BUILD_MODE): BuildMode {
	if (value === undefined || value === 'serial') return 'serial';
	if (value === 'parallel' || value === 'isolated-serial') return value;
	throw new Error('WISCONSIN_BUILD_MODE must be serial, parallel or isolated-serial');
}

interface BuildOptions {
	mode: Exclude<BuildMode, 'serial'>;
	contentRepo: string;
	applicationVersion: string;
	logDirectory: string;
	signal?: AbortSignal;
	log?: (message: string) => void;
	command?: string;
	args?: string[];
	killGraceMs?: number;
}

/** Build normal Vite projects in separate process groups; reap both before returning or rejecting. */
export async function runEditionBuilds(
	sites: { publicSite: string; fullSite: string },
	options: BuildOptions
) {
	const log = options.log ?? console.log;
	const processes = new Set<ChildProcess>();
	const tasks: Promise<number>[] = [];
	const terminations: Promise<void>[] = [];
	const terminating = new Set<ChildProcess>();
	let failure: Error | undefined;
	mkdirSync(options.logDirectory, { recursive: true, mode: 0o700 });

	function signalGroup(child: ChildProcess, signal: NodeJS.Signals) {
		if (child.pid === undefined) return;
		try {
			if (process.platform === 'win32') child.kill(signal);
			else process.kill(-child.pid, signal);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
		}
	}

	function terminate(child: ChildProcess) {
		if (terminating.has(child) || child.pid === undefined) return;
		terminating.add(child);
		signalGroup(child, 'SIGTERM');
		// Retain the deadline even if the direct child exits first: its descendants
		// can ignore SIGTERM or close their inherited pipes before exiting.
		terminations.push(
			new Promise((resolve) => {
				setTimeout(() => {
					try {
						signalGroup(child, 'SIGKILL');
					} finally {
						resolve();
					}
				}, options.killGraceMs ?? 2_000);
			})
		);
	}

	function cancel(error: Error) {
		failure ??= error;
		for (const child of processes) terminate(child);
	}
	const interrupt = () => cancel(new Error('Edition builds interrupted by SIGINT'));
	const terminateSignal = () => cancel(new Error('Edition builds interrupted by SIGTERM'));
	const abort = () =>
		cancel(new Error('Edition builds aborted', { cause: options.signal?.reason }));
	process.on('SIGINT', interrupt);
	process.on('SIGTERM', terminateSignal);
	options.signal?.addEventListener('abort', abort, { once: true });
	if (options.signal?.aborted) abort();

	function start(publicEdition: boolean) {
		if (failure) throw failure;
		const edition = publicEdition ? 'public' : 'full';
		const started = performance.now();
		const file = openSync(path.join(options.logDirectory, `${edition}.log`), 'wx', 0o600);
		let child: ChildProcess;
		try {
			child = spawn(options.command ?? 'bun', options.args ?? ['x', 'vite', 'build'], {
				cwd: publicEdition ? sites.publicSite : sites.fullSite,
				detached: process.platform !== 'win32',
				stdio: ['ignore', 'pipe', 'pipe'],
				env: {
					...process.env,
					NODE_ENV: process.env.NODE_ENV ?? 'production',
					WISCONSIN_CONTENT_REPO: options.contentRepo,
					WISCONSIN_APPLICATION_VERSION: options.applicationVersion,
					VITE_PUBLIC_EDITION: String(publicEdition)
				}
			});
		} catch (error) {
			closeSync(file);
			throw error;
		}
		processes.add(child);
		const task = new Promise<number>((resolve, reject) => {
			let error: Error | undefined;
			for (const stream of [child.stdout!, child.stderr!]) {
				let pending = '';
				stream.setEncoding('utf8');
				stream.on('data', (chunk: string) => {
					try {
						writeSync(file, chunk);
						pending += chunk;
						const lines = pending.split('\n');
						pending = lines.pop()!;
						for (const line of lines) log(`${edition} | ${line}`);
					} catch (cause) {
						error = new Error(`Could not record ${edition} build output`, { cause });
						cancel(error);
					}
				});
				stream.on('end', () => {
					try {
						if (pending) log(`${edition} | ${pending}`);
					} catch (cause) {
						error = new Error(`Could not record ${edition} build output`, { cause });
						cancel(error);
					}
				});
			}
			child.on('error', (cause) => {
				error = new Error(`Could not start ${edition} build`, { cause });
				cancel(error);
			});
			child.on('close', (code, signal) => {
				closeSync(file);
				if (error || code !== 0) {
					error ??= new Error(`${edition} build failed (${signal ?? `exit ${code}`})`);
					cancel(error);
					reject(error);
				} else {
					const seconds = (performance.now() - started) / 1000;
					try {
						log(`build: ${edition} completed in ${seconds.toFixed(2)}s`);
						resolve(seconds);
					} catch (cause) {
						error = new Error(`Could not record ${edition} build timing`, { cause });
						cancel(error);
						reject(error);
					}
				}
				processes.delete(child);
			});
		});
		tasks.push(task);
		return task;
	}

	try {
		let publicSeconds: number;
		let fullSeconds: number;
		if (options.mode === 'parallel') {
			const results = await Promise.allSettled([start(true), start(false)]);
			if (failure) throw failure;
			if (results[0].status === 'rejected') throw results[0].reason;
			if (results[1].status === 'rejected') throw results[1].reason;
			publicSeconds = results[0].value;
			fullSeconds = results[1].value;
		} else {
			publicSeconds = await start(true);
			fullSeconds = await start(false);
		}
		if (failure) throw failure;
		return { publicSeconds, fullSeconds };
	} catch (error) {
		cancel(error instanceof Error ? error : new Error(String(error)));
		throw error;
	} finally {
		await Promise.allSettled(tasks);
		await Promise.all(terminations);
		process.removeListener('SIGINT', interrupt);
		process.removeListener('SIGTERM', terminateSignal);
		options.signal?.removeEventListener('abort', abort);
	}
}
