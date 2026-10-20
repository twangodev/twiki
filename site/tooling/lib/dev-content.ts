import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

/** Keep synchronous compiler/Git work out of Vite's increasingly large process. */
export function developmentContent(site: string) {
	let child: ChildProcess | undefined;
	let closed = false;
	let sequence = 0;
	const pending = new Map<
		number,
		{
			resolve: (files: Set<string>) => void;
			reject: (error: Error) => void;
		}
	>();
	function fail(error: Error) {
		for (const request of pending.values()) request.reject(error);
		pending.clear();
	}
	return {
		prepare(reuse: boolean, inputs?: Set<string>): Promise<Set<string>> {
			if (closed) return Promise.reject(new Error('Content worker is closed'));
			if (!child) {
				const worker = spawn('bun', [path.join(site, 'tooling/dev-content-worker.ts')], {
					cwd: site,
					env: process.env,
					stdio: ['ignore', 'inherit', 'inherit', 'ipc']
				});
				child = worker;
				worker.on('message', (message: { id: number; files?: string[]; error?: string }) => {
					const request = pending.get(message.id);
					if (!request) return;
					pending.delete(message.id);
					if (message.error) request.reject(new Error(message.error));
					else request.resolve(new Set(message.files));
				});
				worker.on('error', fail);
				worker.on('exit', (code, signal) => {
					if (child === worker) child = undefined;
					fail(new Error(`Content worker exited (${signal ?? code})`));
				});
			}
			const worker = child;
			const id = ++sequence;
			return new Promise((resolve, reject) => {
				pending.set(id, { resolve, reject });
				worker.send({ id, reuse, inputs: inputs && [...inputs] }, (error) => {
					if (!error) return;
					pending.delete(id);
					reject(error);
				});
			});
		},
		close() {
			closed = true;
			fail(new Error('Content worker is closed'));
			child?.kill();
		}
	};
}
