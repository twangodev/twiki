import { expect, test } from 'bun:test';
import type { Emulator } from '@sveltejs/kit';
import { prewarmCloudflareEmulator } from '../../tooling/lib/cloudflare-prewarm.js';

type Details = Parameters<NonNullable<Emulator['platform']>>[0];

async function withMode(mode: string | undefined, run: () => void | Promise<void>) {
	const previous = process.env.NODE_ENV;
	if (mode === undefined) delete process.env.NODE_ENV;
	else process.env.NODE_ENV = mode;
	try {
		await run();
	} finally {
		if (previous === undefined) delete process.env.NODE_ENV;
		else process.env.NODE_ENV = previous;
	}
}

test('development starts initialization eagerly and concurrent requests share it', async () => {
	await withMode('development', async () => {
		const ready = Promise.withResolvers<App.Platform>();
		const calls: Details[] = [];
		let initialized = false;
		let initializations = 0;
		const value = {} as App.Platform;
		const emulator: Emulator = {
			async platform(details) {
				calls.push(details);
				if (!initialized) {
					initializations++;
					await ready.promise;
					initialized = true;
				}
				return value;
			}
		};
		const wrapped = prewarmCloudflareEmulator(emulator);
		expect(calls).toEqual([{ config: {}, prerender: false }]);
		const firstDetails = { config: { route: 'first' }, prerender: false };
		const secondDetails = { config: { route: 'second' }, prerender: true };
		const first = wrapped.platform!(firstDetails);
		const second = wrapped.platform!(secondDetails);
		expect(initializations).toBe(1);
		expect(calls).toHaveLength(1);
		ready.resolve(value);
		expect(await first).toBe(value);
		expect(await second).toBe(value);
		expect(initializations).toBe(1);
		expect(calls.slice(1)).toEqual([firstDetails, secondDetails]);
	});
});

test('failed initialization reaches waiting requests and the next request retries', async () => {
	await withMode('development', async () => {
		const failure = new Error('Cloudflare unavailable');
		const value = {} as App.Platform;
		let initializations = 0;
		let initialized = false;
		const wrapped = prewarmCloudflareEmulator({
			async platform() {
				if (!initialized) {
					initializations++;
					if (initializations === 1) throw failure;
					initialized = true;
				}
				return value;
			}
		});
		await expect(wrapped.platform!({ config: {}, prerender: false })).rejects.toBe(failure);
		expect(await wrapped.platform!({ config: {}, prerender: false })).toBe(value);
		expect(initializations).toBe(2);
	});
});

test('synchronous background errors are observed and a later request can retry', async () => {
	await withMode('development', async () => {
		const value = {} as App.Platform;
		let calls = 0;
		let wrapped: Emulator | undefined;
		expect(() => {
			wrapped = prewarmCloudflareEmulator({
				platform() {
					if (++calls === 1) throw new Error('Invalid local configuration');
					return value;
				}
			});
		}).not.toThrow();
		await Promise.resolve(); // Let the observed failure clear its initialization attempt.
		expect(await wrapped!.platform!({ config: {}, prerender: false })).toBe(value);
		expect(calls).toBe(3); // Failed warmup, successful retry, original request forwarding.
	});
});

test('production, test and unset environments preserve the original lazy emulator', async () => {
	for (const mode of ['production', 'test', undefined]) {
		await withMode(mode, () => {
			let calls = 0;
			const emulator: Emulator = {
				platform() {
					calls++;
					return {} as App.Platform;
				}
			};
			expect(prewarmCloudflareEmulator(emulator)).toBe(emulator);
			expect(calls).toBe(0);
		});
	}
});

test('requests retain prerender protection, route config and other emulator methods', async () => {
	await withMode('development', async () => {
		const full = {} as App.Platform;
		const protectedPlatform = {} as App.Platform;
		const calls: Details[] = [];
		const emulator = {
			marker: 'preserved',
			otherMethod() {
				return this.marker;
			},
			platform(details: Details) {
				expect(this).toBe(emulator);
				calls.push(details);
				return details.prerender ? protectedPlatform : full;
			}
		};
		const wrapped = prewarmCloudflareEmulator(emulator) as typeof emulator;
		expect(wrapped.otherMethod).toBe(emulator.otherMethod);
		expect(wrapped.otherMethod()).toBe('preserved');
		for (const prerender of [true, 'auto'] as const) {
			const details = { config: { arbitrary: 'unchanged' }, prerender };
			expect(await wrapped.platform(details)).toBe(protectedPlatform);
			expect(calls.at(-1)).toBe(details);
		}
		const details = { config: { auth: true }, prerender: false };
		expect(await wrapped.platform(details)).toBe(full);
		expect(calls.at(-1)).toBe(details);
	});
});

test('emulators without a platform provider remain unchanged', async () => {
	await withMode('development', () => {
		const emulator = {};
		expect(prewarmCloudflareEmulator(emulator)).toBe(emulator);
	});
});
