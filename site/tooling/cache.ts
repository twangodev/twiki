import { execFileSync } from 'node:child_process';
import {
	appendFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compilerCacheFiles } from './lib/cache-selection';

const mode = process.argv[2];
if (mode === 'plan' || mode === 'save-products' || mode === 'restore-products') {
	const { planProductCaches, transferProductCaches } = await import('./lib/product-cache');
	const { resolve } = await import('node:path');
	const options: import('./lib/product-cache').ProductOptions = {};
	let planFile: string | undefined;
	for (let i = 3; i < process.argv.length; i++) {
		const argument = process.argv[i];
		if (argument === '--restore') options.restore = true;
		else if (argument === '--group') options.group = process.argv[++i];
		else if (argument === '--namespace') {
			const namespace = process.argv[++i];
			if (!['production', 'benchmark'].includes(namespace))
				throw new Error('Invalid product namespace');
			options.namespace = namespace as import('./lib/product-cache').ProductNamespace;
		} else if (argument === '--kind') {
			const kind = process.argv[++i];
			if (!['global', 'course', 'search', 'application'].includes(kind))
				throw new Error('Invalid product kind');
			options.kind = kind as import('./lib/product-cache').ProductKind;
		} else if (argument === '--plan-file') planFile = process.argv[++i];
		else throw new Error('Invalid product-cache argument');
	}
	const result =
		mode === 'plan'
			? await planProductCaches(process.cwd(), options)
			: await transferProductCaches(
					process.cwd(),
					mode === 'save-products' ? 'save' : 'restore',
					process.env.BUILD_CACHE_KEY,
					options
				);
	const json = JSON.stringify(result);
	if (planFile) {
		mkdirSync(path.dirname(resolve(planFile)), { recursive: true });
		writeFileSync(resolve(planFile), json + '\n', { mode: 0o600 });
	} else console.log(json);
	process.exit(0);
}
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
		console.log('Compiler cache archive restored; each stage validates its own inputs');
	} else {
		const files = compilerCacheFiles(cache);
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
		console.log(`Compiler cache encrypted (${files.length} current files)`);
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
