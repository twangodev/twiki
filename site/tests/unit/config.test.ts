import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rolldown } from 'rolldown';

async function configuredAuth(enabled: boolean, staticExport = false) {
	const directory = mkdtempSync(path.join(os.tmpdir(), 'twiki-node-config-'));
	try {
		writeFileSync(
			path.join(directory, 'config.ts'),
			readFileSync(new URL('../../src/lib/config.ts', import.meta.url))
		);
		writeFileSync(
			path.join(directory, 'site-config.json'),
			JSON.stringify({ name: 'Configured notes' })
		);
		writeFileSync(path.join(directory, 'auth-config.json'), JSON.stringify({ enabled }));
		const bundle = await rolldown({
			input: path.join(directory, 'config.ts'),
			...(staticExport
				? { transform: { define: { 'import.meta.env.VITE_STATIC_EXPORT': '"true"' } } }
				: {})
		});
		try {
			const output = await bundle.generate({ format: 'esm' });
			const chunk = output.output.find((item) => item.type === 'chunk');
			if (!chunk) throw new Error('Expected a generated configuration module');
			const file = path.join(directory, 'config.mjs');
			writeFileSync(file, chunk.code);
			return JSON.parse(
				execFileSync(
					'node',
					[
						'--input-type=module',
						'-e',
						`const config = await import(${JSON.stringify(file)}); console.log(JSON.stringify({ name: config.site.name, authEnabled: config.authEnabled }));`
					],
					{ encoding: 'utf8' }
				)
			);
		} finally {
			await bundle.close();
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test('configured GitHub auth and branding load in Node tooling before Vite defines import.meta.env', async () => {
	expect(await configuredAuth(true)).toEqual({ name: 'Configured notes', authEnabled: true });
});

test('public-only hosts leave auth disabled in Node tooling', async () => {
	expect(await configuredAuth(false)).toEqual({ name: 'Configured notes', authEnabled: false });
});

test('static builds disable account controls even with GitHub configured', async () => {
	expect(await configuredAuth(true, true)).toEqual({
		name: 'Configured notes',
		authEnabled: false
	});
});
