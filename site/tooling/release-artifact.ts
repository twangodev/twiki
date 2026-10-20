import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, mkdtemp, open, readdir, rm, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function releaseArtifact(
	mode: string,
	filename: string,
	{ site = path.resolve(import.meta.dir, '..'), environment = process.env } = {}
) {
	if (!['pack', 'unpack'].includes(mode) || !filename)
		throw new Error('Use pack|unpack <encrypted release>');
	const { BUILD_CACHE_KEY: secret, GITHUB_SHA: sha, GITHUB_RUN_ID: run } = environment;
	const attempt = environment.ARTIFACT_RUN_ATTEMPT ?? environment.GITHUB_RUN_ATTEMPT;
	if (
		!secret ||
		!/^[a-f0-9]{40}$/.test(sha ?? '') ||
		!/^\d+$/.test(run ?? '') ||
		!/^\d+$/.test(attempt ?? '')
	)
		throw new Error(
			'Release transfer requires BUILD_CACHE_KEY and an exact GitHub commit, run and attempt'
		);
	const key = createHash('sha256')
		.update(JSON.stringify(['twiki-release-v1', secret, sha, run, attempt]))
		.digest();
	const temporary = await mkdtemp(path.join(tmpdir(), 'twiki-release-'));
	const archive = path.join(temporary, 'release.tar.gz');
	try {
		if (mode === 'pack') {
			const files: Record<string, Uint8Array> = {
				'build/.svelte-kit/deployment.json': await Bun.file(
					path.join(site, 'build/.svelte-kit/deployment.json')
				).bytes()
			};
			for (const directory of [
				'build/.svelte-kit/prepared-worker',
				'build/.svelte-kit/cloudflare'
			]) {
				for (const entry of await readdir(path.join(site, directory), {
					recursive: true,
					withFileTypes: true
				})) {
					if (entry.isDirectory()) continue;
					if (!entry.isFile()) throw new Error('Release must contain only regular files');
					const file = path.join(entry.parentPath, entry.name);
					files[path.relative(site, file).split(path.sep).join('/')] = await Bun.file(file).bytes();
				}
			}
			await Bun.Archive.write(archive, files, { compress: 'gzip' });
			const nonce = randomBytes(12);
			const cipher = createCipheriv('aes-256-gcm', key, nonce);
			await writeFile(filename, nonce, { mode: 0o600 });
			await pipeline(
				createReadStream(archive),
				cipher,
				createWriteStream(filename, { flags: 'a' })
			);
			await appendFile(filename, cipher.getAuthTag());
		} else {
			const file = await open(filename, 'r');
			const header = Buffer.alloc(28);
			let size: number;
			try {
				size = (await file.stat()).size;
				if (size < 28) throw new Error('Invalid encrypted release');
				await file.read(header, 0, 12, 0);
				await file.read(header, 12, 16, size - 16);
			} finally {
				await file.close();
			}
			const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(0, 12));
			decipher.setAuthTag(header.subarray(12));
			// Verify the complete archive before extracting any generated files.
			await pipeline(
				createReadStream(filename, { start: 12, end: size - 17 }),
				decipher,
				createWriteStream(archive, { mode: 0o600 })
			);
			await new Bun.Archive(await Bun.file(archive).bytes()).extract(site);
		}
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	const [mode, filename, ...extra] = process.argv.slice(2);
	if (extra.length) throw new Error('Use pack|unpack <encrypted release>');
	await releaseArtifact(mode, filename);
}
