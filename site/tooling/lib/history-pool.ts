import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import type { CourseFile } from '../../src/lib/files';

export type HistoryJob = {
	repo: string;
	output: string;
	cache: string;
	files: { file: CourseFile; source: string }[];
};

export async function buildHistories(
	jobs: HistoryJob[],
	retain: (job: HistoryJob, file: string) => void
) {
	if (!jobs.length) return;
	const requested = Number(
		process.env.WISCONSIN_HISTORY_WORKERS ?? Math.min(8, availableParallelism())
	);
	if (!Number.isInteger(requested) || requested < 1 || requested > 48)
		throw new Error('WISCONSIN_HISTORY_WORKERS must be an integer from 1 to 48');
	const started = performance.now();
	let next = 0;
	let failure: unknown;
	const results = await Promise.allSettled(
		Array.from({ length: Math.min(requested, jobs.length) }, async () => {
			while (!failure && next < jobs.length) {
				const job = jobs[next++];
				try {
					const result = await new Promise<{ histories: (string | null)[]; outputs: string[] }>(
						(resolve, reject) => {
							const child = spawn('bun', [path.join(import.meta.dirname, 'history-worker.ts')], {
								stdio: ['pipe', 'pipe', 'pipe']
							});
							let stdout = '',
								stderr = '';
							child.stdout.setEncoding('utf8').on('data', (chunk) => {
								stdout += chunk;
							});
							child.stderr.setEncoding('utf8').on('data', (chunk) => {
								stderr += chunk;
							});
							child.on('error', reject);
							child.stdin.on('error', reject);
							child.on('close', (code) => {
								if (code !== 0)
									return reject(new Error(`History worker failed for ${job.repo}: ${stderr}`));
								try {
									resolve(JSON.parse(stdout));
								} catch (error) {
									reject(error);
								}
							});
							child.stdin.end(JSON.stringify(job));
						}
					);
					job.files.forEach(({ file }, i) => {
						file.history = result.histories[i] ?? undefined;
					});
					for (const output of result.outputs) retain(job, output);
				} catch (error) {
					failure = error;
					throw error;
				}
			}
		})
	);
	const failed = results.find((result) => result.status === 'rejected');
	if (failed?.status === 'rejected') throw failed.reason;
	console.log(
		`history: ${jobs.length} courses with ${Math.min(requested, jobs.length)} workers in ${((performance.now() - started) / 1000).toFixed(2)}s`
	);
}
