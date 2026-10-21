/** Coalesce a burst and retain at most one follow-up while a build is running. */
export function rebuildQueue(build: () => Promise<void>, delay = 0) {
	let dirty = false;
	let running = false;
	let pending = Promise.resolve();
	return {
		schedule() {
			dirty = true;
			if (running) return;
			running = true;
			pending = (async () => {
				try {
					await new Promise((resolve) => setTimeout(resolve, delay));
					while (dirty) {
						dirty = false;
						await build();
					}
				} finally {
					running = false;
				}
			})();
		},
		wait: () => pending
	};
}

/** Retry a fast failure after watcher suppression expires, without delaying successful work. */
export async function retryEarlyFailure<T>(build: () => Promise<T>, window: number) {
	const started = performance.now();
	try {
		return await build();
	} catch (error) {
		const remaining = window - (performance.now() - started);
		if (remaining <= 0) throw error;
		await new Promise((resolve) => setTimeout(resolve, Math.ceil(remaining)));
		return build();
	}
}
