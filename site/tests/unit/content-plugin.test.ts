import { expect, test } from 'bun:test';
import { content } from '../../tooling/vite-content';

test('content preparation precedes SvelteKit static asset discovery', () => {
	const plugin = content();
	expect(plugin.enforce).toBe('pre');
	expect(typeof plugin.config).toBe('object');
	if (plugin.config && typeof plugin.config === 'object') expect(plugin.config.order).toBe('pre');
});

test('installation synchronizes types without compiling course content', async () => {
	const previous = process.env.npm_lifecycle_event;
	process.env.npm_lifecycle_event = 'prepare';
	try {
		const hook = content().config;
		if (!hook || typeof hook !== 'object') throw new Error('Missing ordered config hook');
		await hook.handler.call({} as never, {}, { command: 'build', mode: 'production' });
	} finally {
		if (previous === undefined) delete process.env.npm_lifecycle_event;
		else process.env.npm_lifecycle_event = previous;
	}
});
