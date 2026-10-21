import { Worker } from 'node:worker_threads';

// Below this conservative cutoff, scanning outputs cannot amortize a new VM.
export const minimumParallelOutputs = 32_768;

/** Warm a disposable VM now; the gate delays source reads and false cancels them.
 * An undefined result requires a fresh in-process capture.
 */
export async function freshInputFingerprint(
	repo: string,
	key: string,
	after?: Promise<boolean | void>
) {
	// Observe a failed gate even if the worker cannot be constructed.
	void after?.catch(() => {});
	let worker: Worker | undefined;
	try {
		worker = new Worker(new URL('../dev-input-worker.ts', import.meta.url), {
			workerData: { repo, key }
		});
		const result = new Promise<string | undefined>((resolve) => {
			worker!.once('message', (message: unknown) =>
				resolve(typeof message === 'string' && /^[a-f0-9]{64}$/.test(message) ? message : undefined)
			);
			worker!.once('error', () => resolve(undefined));
			worker!.once('exit', () => resolve(undefined));
		});
		if ((await after) === false) return;
		worker.postMessage('capture');
		return await result;
	} catch {
		return undefined;
	} finally {
		await worker?.terminate();
	}
}
