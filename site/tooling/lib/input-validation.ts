import { Worker } from 'node:worker_threads';

// Below this conservative cutoff, scanning outputs cannot amortize a new VM.
export const minimumParallelOutputs = 32_768;

/** Fresh source validation in a disposable worker; undefined requires an in-process capture. */
export async function freshInputFingerprint(repo: string, key: string) {
	let worker: Worker | undefined;
	try {
		worker = new Worker(new URL('../dev-input-worker.ts', import.meta.url), {
			workerData: { repo, key }
		});
		return await new Promise<string | undefined>((resolve) => {
			worker!.once('message', (message: unknown) =>
				resolve(typeof message === 'string' && /^[a-f0-9]{64}$/.test(message) ? message : undefined)
			);
			worker!.once('error', () => resolve(undefined));
			worker!.once('exit', () => resolve(undefined));
		});
	} catch {
		return undefined;
	} finally {
		await worker?.terminate();
	}
}
