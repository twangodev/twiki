import { execFileSync } from 'node:child_process';
import {
	appendFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const mode = process.argv[2];
if (mode !== 'restore' && mode !== 'save') throw new Error('Expected restore or save');
const secret = process.env.BUILD_CACHE_KEY;
const cache = path.resolve('build/generated/cache');
const encrypted = path.resolve('build/generated/compiler-cache.gpg');
if (!secret || (mode === 'restore' && !existsSync(encrypted))) {
	console.log(
		mode === 'restore' ? 'No cache or key; building cold' : 'No key; skipping cache save'
	);
	process.exit(0);
}

const temporary = mkdtempSync(path.join(tmpdir(), 'wisconsin-cache-'));
const archive = path.join(temporary, 'cache.tar.gz');
const status = path.join(temporary, 'status');
const env = { ...process.env, GNUPGHOME: temporary };
const run = (command: string, args: string[]) =>
	execFileSync(command, args, {
		env,
		input: command === 'gpg' ? secret + '\n' : undefined,
		stdio: 'pipe'
	});
const gpg = [
	'--batch',
	'--yes',
	'--pinentry-mode',
	'loopback',
	'--no-symkey-cache',
	'--passphrase-fd',
	'0'
];

try {
	if (mode === 'restore') {
		run('gpg', [...gpg, '--status-file', status, '--output', archive, '--decrypt', encrypted]);
		if (!readFileSync(status, 'utf8').split('\n').includes('[GNUPG:] GOODMDC'))
			throw new Error('Cache integrity was not verified');
		const staged = path.join(temporary, 'unpacked');
		mkdirSync(staged);
		run('tar', ['-xzf', archive, '-C', staged, '--no-same-owner']);
		mkdirSync(cache, { recursive: true });
		cpSync(staged, cache, { recursive: true });
		console.log('Compiler cache restored');
	} else {
		const files = readdirSync(cache).filter(
			(file) =>
				['stage1', 'file-history', 'social-titles'].includes(file) ||
				/^gitdates-v2-[\w-]+\.json$/.test(file)
		);
		run('tar', ['-czf', archive, '-C', cache, ...files]);
		run('gpg', [
			...gpg,
			'--symmetric',
			'--cipher-algo',
			'AES256',
			'--compress-algo',
			'none',
			'--output',
			encrypted,
			archive
		]);
		if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'ready=true\n');
		console.log('Compiler cache encrypted');
	}
} catch {
	console.log(
		mode === 'restore'
			? 'Cache could not be verified; building cold'
			: 'Cache encryption failed; skipping cache save'
	);
} finally {
	try {
		run('gpgconf', ['--kill', 'gpg-agent']);
	} catch {}
	rmSync(temporary, { recursive: true, force: true });
}
