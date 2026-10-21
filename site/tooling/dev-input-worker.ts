import { parentPort, workerData } from 'node:worker_threads';
import { contentInputFingerprint } from './lib/dev-state';
import { withSourceDiscovery } from './lib/project-config';

try {
	const fingerprint = await withSourceDiscovery(() =>
		contentInputFingerprint(workerData.repo, workerData.key)
	);
	parentPort?.postMessage(fingerprint);
} catch {
	// The caller repeats failed validation in-process to preserve the original error.
	parentPort?.postMessage(undefined);
} finally {
	parentPort?.close();
}
