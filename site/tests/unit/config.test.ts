import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rolldown } from 'rolldown';

test('configured GitHub auth and branding can load in Node tooling before Vite defines import.meta.env', async () => {
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
		writeFileSync(path.join(directory, 'auth-config.json'), JSON.stringify({ enabled: true }));
		const bundle = await rolldown({ input: path.join(directory, 'config.ts') });
		try {
			const output = await bundle.generate({ format: 'esm' });
			const file = path.join(directory, 'config.mjs');
			writeFileSync(file, output.output[0].code);
			const result = execFileSync(
				'node',
				[
					'--input-type=module',
					'-e',
					`const config = await import(${JSON.stringify(file)}); console.log(JSON.stringify({ name: config.site.name, authEnabled: config.authEnabled }));`
				],
				{ encoding: 'utf8' }
			);
			expect(JSON.parse(result)).toEqual({ name: 'Configured notes', authEnabled: true });
		} finally {
			await bundle.close();
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
