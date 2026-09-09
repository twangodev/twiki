/** Coalesce a burst and retain at most one follow-up while a build is running. */
export function rebuildQueue(build: () => Promise<void>, delay = 100) {
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
