import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { releaseArtifact as artifact } from '../../tooling/release-artifact';

test('release handoff preserves hidden assets and rejects tampering and mixed runs before extraction', async () => {
	const temporary = await mkdtemp(path.join(tmpdir(), 'twiki-release-test-'));
	const source = path.join(temporary, 'source');
	const environment = {
		BUILD_CACHE_KEY: 'test-only-artifact-key',
		GITHUB_SHA: 'a'.repeat(40),
		GITHUB_RUN_ID: '123',
		GITHUB_RUN_ATTEMPT: '1'
	};
	try {
		await mkdir(path.join(source, 'build/.svelte-kit/cloudflare/_content'), {
			recursive: true
		});
		await mkdir(path.join(source, 'build/.svelte-kit/prepared-worker'), {
			recursive: true
		});
		const files = {
			'build/.svelte-kit/cloudflare/_content/current.json': '{"private":"course content"}',
			'build/.svelte-kit/cloudflare/.assetsignore': 'excluded.txt\n',
			'build/.svelte-kit/prepared-worker/worker.json': '{"modules":[]}',
			'build/.svelte-kit/cloudflare/first.txt': 'duplicated asset body',
			'build/.svelte-kit/cloudflare/second.txt': 'duplicated asset body',
			'build/.svelte-kit/deployment.json': ''
		};
		for (const [file, contents] of Object.entries(files))
			await writeFile(path.join(source, file), contents);
		const encrypted = path.join(temporary, 'release.enc');
		await artifact('pack', encrypted, { site: source, environment });
		const bytes = await readFile(encrypted);
		expect(bytes.includes(Buffer.from('course content'))).toBe(false);
		const destination = path.join(temporary, 'destination');
		await artifact('unpack', encrypted, {
			site: destination,
			environment
		});
		for (const [file, contents] of Object.entries(files))
			expect(await readFile(path.join(destination, file), 'utf8')).toBe(contents);
		await artifact('unpack', encrypted, {
			site: path.join(temporary, 'retry'),
			environment: {
				...environment,
				GITHUB_RUN_ATTEMPT: '2',
				ARTIFACT_RUN_ATTEMPT: '1'
			}
		});

		const rejected = path.join(temporary, 'rejected');
		for (const change of [
			{ BUILD_CACHE_KEY: 'wrong-key' },
			{ GITHUB_SHA: 'b'.repeat(40) },
			{ GITHUB_RUN_ID: '124' },
			{ GITHUB_RUN_ATTEMPT: '2' }
		]) {
			await expect(
				artifact('unpack', encrypted, {
					site: rejected,
					environment: { ...environment, ...change }
				})
			).rejects.toThrow();
		}
		await expect(artifact('invalid', encrypted, { site: rejected, environment })).rejects.toThrow();
		for (const offset of [0, 12, bytes.length - 1]) {
			const corrupted = Buffer.from(bytes);
			corrupted[offset] ^= 1;
			await writeFile(encrypted, corrupted);
			await expect(
				artifact('unpack', encrypted, { site: rejected, environment })
			).rejects.toThrow();
		}
		await writeFile(encrypted, bytes.subarray(0, 20));
		await expect(artifact('unpack', encrypted, { site: rejected, environment })).rejects.toThrow();
		await expect(
			readFile(path.join(rejected, 'build/.svelte-kit/deployment.json'))
		).rejects.toThrow();
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});
