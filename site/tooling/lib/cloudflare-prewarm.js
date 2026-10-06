/**
 * Prewarm the Cloudflare adapter's public emulator during development.
 * Cloudflare initializes one platform independently of route config; this helper
 * is scoped to that adapter. Actual requests still receive their original
 * config and prerender options, including the adapter's protected prerender env.
 *
 * @param {import('@sveltejs/kit').Emulator} emulator
 * @returns {import('@sveltejs/kit').Emulator}
 */
export function prewarmCloudflareEmulator(emulator) {
	if (process.env.NODE_ENV !== 'development' || !emulator.platform) return emulator;
	const platform = emulator.platform.bind(emulator);
	/** @type {Promise<App.Platform> | undefined} */
	let initialization;
	const initialize = () => {
		if (initialization) return initialization;
		/** @type {Promise<App.Platform>} */
		let attempt;
		try {
			attempt = Promise.resolve(platform({ config: {}, prerender: false }));
		} catch (error) {
			attempt = Promise.reject(error);
		}
		initialization = attempt;
		// Observe background failures immediately. Requests already awaiting this
		// attempt still fail; a later request can retry initialization.
		void attempt.catch(() => {
			if (initialization === attempt) initialization = undefined;
		});
		return attempt;
	};
	initialize();
	return {
		...emulator,
		async platform(details) {
			await initialize();
			return platform(details);
		}
	};
}
