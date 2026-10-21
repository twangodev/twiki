import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { ContentRepository } from './dev-git-state';

export type ContentRepositoryWatch = Pick<
	ContentRepository,
	'directory' | 'gitDirectory' | 'commonDirectory' | 'index' | 'config' | 'worktreeConfig'
>;
export type ContentWorkerTask =
	| { kind: 'prepare'; reuse: boolean; inputs?: string[] }
	| { kind: 'repositories'; repo: string };
export interface ContentWorkerReply {
	id: number;
	files?: string[];
	repositories?: ContentRepositoryWatch[];
	error?: string;
}

/** Keep synchronous compiler/Git work out of Vite's increasingly large process. */
export function developmentContent(site: string) {
	let child: ChildProcess | undefined;
	let closed = false;
	let sequence = 0;
	const pending = new Map<
		number,
		{
			resolve: (reply: ContentWorkerReply) => void;
			reject: (error: Error) => void;
		}
	>();
	function fail(error: Error) {
		for (const request of pending.values()) request.reject(error);
		pending.clear();
	}
	function request(task: ContentWorkerTask): Promise<ContentWorkerReply> {
		if (closed) return Promise.reject(new Error('Content worker is closed'));
		if (!child) {
			const worker = spawn('bun', [path.join(site, 'tooling/dev-content-worker.ts')], {
				cwd: site,
				env: process.env,
				stdio: ['ignore', 'inherit', 'inherit', 'ipc']
			});
			child = worker;
			worker.on('message', (message: ContentWorkerReply) => {
				const request = pending.get(message.id);
				if (!request) return;
				pending.delete(message.id);
				if (message.error) request.reject(new Error(message.error));
				else request.resolve(message);
			});
			worker.on('error', (error) => {
				if (child !== worker) return;
				child = undefined;
				fail(error);
			});
			worker.on('exit', (code, signal) => {
				if (child !== worker) return;
				child = undefined;
				fail(new Error(`Content worker exited (${signal ?? code})`));
			});
		}
		const worker = child;
		const id = ++sequence;
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
			try {
				worker.send({ id, ...task }, (error) => {
					if (!error) return;
					pending.delete(id);
					reject(error);
				});
			} catch (error) {
				pending.delete(id);
				reject(error);
			}
		});
	}
	return {
		async prepare(reuse: boolean, inputs?: Set<string>): Promise<Set<string>> {
			const reply = await request({ kind: 'prepare', reuse, inputs: inputs && [...inputs] });
			if (!Array.isArray(reply.files) || !reply.files.every((file) => typeof file === 'string'))
				throw new Error('Invalid content worker response');
			return new Set(reply.files);
		},
		async repositories(repo: string): Promise<ContentRepositoryWatch[]> {
			const reply = await request({ kind: 'repositories', repo });
			const fields = [
				'directory',
				'gitDirectory',
				'commonDirectory',
				'index',
				'config',
				'worktreeConfig'
			] as const;
			if (
				!Array.isArray(reply.repositories) ||
				!reply.repositories.every(
					(entry) =>
						entry &&
						fields.every(
							(field) => typeof entry[field] === 'string' && path.isAbsolute(entry[field])
						)
				)
			)
				throw new Error('Invalid repository discovery response');
			return reply.repositories;
		},
		close() {
			closed = true;
			fail(new Error('Content worker is closed'));
			child?.kill();
		}
	};
}
