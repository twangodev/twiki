import { execFileSync } from 'node:child_process';
import {
	appendFileSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compilerCacheFiles, portableCachePath } from './lib/cache-selection';

const mode = process.argv[2];
if (mode !== 'restore' && mode !== 'save') throw new Error('Expected restore or save');
const secret = process.env.BUILD_CACHE_KEY;
const cache = path.resolve('build/generated/cache');
const encrypted = path.resolve('build/generated/compiler-cache.gpg');
if (!secret) {
	console.log(
		mode === 'restore'
			? 'BUILD_CACHE_KEY is missing; building cold'
			: 'BUILD_CACHE_KEY is missing; skipping cache save'
	);
	process.exit(0);
}
if (mode === 'restore' && !existsSync(encrypted)) {
	console.log('No compatible cache archive was restored; building cold');
	process.exit(0);
}

const temporary = mkdtempSync(path.join(tmpdir(), 'twiki-cache-'));
const archive = path.join(temporary, 'cache.tar.gz');
const status = path.join(temporary, 'status');
const env = { ...process.env, GNUPGHOME: temporary };
const run = (command: string, args: string[]) =>
	execFileSync(command, args, {
		env,
		input: command === 'gpg' ? secret + '\n' : undefined,
		stdio: 'pipe',
		maxBuffer: 32 * 1024 * 1024
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

function restoreCompilerCache() {
	run('gpg', [...gpg, '--status-file', status, '--output', archive, '--decrypt', encrypted]);
	if (!readFileSync(status, 'utf8').split('\n').includes('[GNUPG:] GOODMDC'))
		throw new Error('Cache integrity was not verified');
	const members = run('tar', ['-tzf', archive]).toString().trimEnd().split('\n');
	if (!members.every(portableCachePath)) throw new Error('Unsafe cache archive');
	const staged = path.join(temporary, 'unpacked');
	mkdirSync(staged);
	run('tar', ['-xzf', archive, '-C', staged, '--no-same-owner', '--no-same-permissions']);
	for (const member of members) {
		const file = path.join(staged, member);
		if (!lstatSync(file).isFile() || realpathSync(file) !== file)
			throw new Error('Cache entries must be regular files');
	}
	mkdirSync(cache, { recursive: true });
	cpSync(staged, cache, { recursive: true });
	console.log('Compiler cache archive restored; each stage validates its own inputs');
}

function saveCompilerCache() {
	const files = compilerCacheFiles(cache);
	if (!files.length) throw new Error('No current compiler cache entries');
	const list = path.join(temporary, 'files');
	writeFileSync(list, files.map((file) => file + '\0').join(''));
	run('tar', ['-czf', archive, '-C', cache, '--null', '--files-from', list]);
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
	const bytes = files.reduce((sum, file) => sum + statSync(path.join(cache, file)).size, 0);
	console.log(
		`Compiler cache encrypted (${files.length} current files, ${(bytes / 1024 ** 2).toFixed(1)} MiB before compression)`
	);
}

try {
	if (mode === 'restore') restoreCompilerCache();
	else saveCompilerCache();
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
