// Benchmark preparation only. Never run while another build/dev process uses this checkout.
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import {
	constants,
	cpSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const targets = [
	'build/.svelte-kit',
	'build/generated',
	'src/lib/generated',
	'node_modules/.vite',
	'node_modules/.vite-temp',
	'node_modules/.cache'
];
type State = {
	version: 1;
	site: string;
	repository: string;
	directory: string;
	token: string;
	device: number;
	inode: number;
	files: string[];
	bytes: number;
	selectionSha256: string;
	seedContentSha256: string;
};
const within = (root: string, file: string) => file === root || file.startsWith(root + path.sep);
function insist(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}
function noLinks(absolute: string) {
	insist(
		path.isAbsolute(absolute) && path.resolve(absolute) === absolute,
		'Use an absolute normalized path'
	);
	let current = path.parse(absolute).root;
	for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
		current = path.join(current, part);
		const info = lstatSync(current, { throwIfNoEntry: false });
		if (!info) return;
		insist(
			!info.isSymbolicLink() && realpathSync(current) === current,
			'Refusing a symlink or redirected ancestor'
		);
	}
}
function git(site: string, args: string[]) {
	return execFileSync('git', ['-C', site, ...args], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		maxBuffer: 32 * 1024 * 1024
	});
}
function validateSite(site: string) {
	noLinks(site);
	insist(lstatSync(site).isDirectory(), 'Site must be a real directory');
	const repository = git(site, ['rev-parse', '--show-toplevel']).trim();
	noLinks(repository);
	insist(site === path.join(repository, 'site'), 'Site must be the Git repository site directory');
	for (const file of ['package.json', 'tooling/lib/cache-selection.ts']) {
		noLinks(path.join(site, file));
		insist(lstatSync(path.join(site, file)).isFile(), 'Missing maintained site compiler');
	}
	return repository;
}
function privateFile(file: string) {
	noLinks(file);
	const info = lstatSync(file);
	insist(
		info.isFile() &&
			(info.mode & 0o077) === 0 &&
			(!process.getuid || info.uid === process.getuid()),
		'Metadata must be a private owned regular file'
	);
}
function validRelative(file: string) {
	insist(
		file.length > 0 &&
			!path.isAbsolute(file) &&
			!file.split('/').some((part) => !part || part === '.' || part === '..') &&
			!file.includes('\\'),
		'Invalid cache file path'
	);
}
function seedContentHash(cache: string, files: string[]) {
	const hash = createHash('sha256').update('controlled-compiler-seed-v1');
	for (const file of [...files].sort()) {
		const absolute = path.join(cache, file);
		noLinks(absolute);
		insist(lstatSync(absolute).isFile(), 'Seed must contain only regular files');
		const bytes = readFileSync(absolute);
		hash.update(JSON.stringify([file, bytes.length])).update(bytes);
	}
	return hash.digest('hex');
}
function readState(stateFile: string): State {
	privateFile(stateFile);
	const state = JSON.parse(readFileSync(stateFile, 'utf8')) as State;
	insist(state.version === 1 && /^[a-f0-9]{64}$/.test(state.token), 'Invalid seed token');
	insist(
		Array.isArray(state.files) && state.files.every((file) => typeof file === 'string'),
		'Invalid seed inventory'
	);
	state.files.forEach(validRelative);
	insist(new Set(state.files).size === state.files.length, 'Duplicate seed inventory');
	insist(
		state.selectionSha256 ===
			createHash('sha256').update(JSON.stringify(state.files)).digest('hex'),
		'Changed seed inventory'
	);
	insist(/^[a-f0-9]{64}$/.test(state.seedContentSha256), 'Invalid seed content digest');
	insist(state.repository === validateSite(state.site), 'Repository identity changed');
	insist(
		!within(state.repository, stateFile) && !within(state.repository, state.directory),
		'Seed and metadata must stay outside the repository'
	);
	noLinks(state.directory);
	const tempRoot = realpathSync(os.tmpdir());
	noLinks(tempRoot);
	insist(
		path.dirname(state.directory) === tempRoot &&
			/^wisconsin-controlled-seed-[A-Za-z0-9]{6}$/.test(path.basename(state.directory)),
		'Seed must be an owned generated temporary directory'
	);
	const info = lstatSync(state.directory);
	insist(
		info.isDirectory() &&
			info.dev === state.device &&
			info.ino === state.inode &&
			(info.mode & 0o077) === 0 &&
			(!process.getuid || info.uid === process.getuid()),
		'Seed directory identity changed'
	);
	const owner = path.join(state.directory, 'owner.json');
	privateFile(owner);
	insist(
		readFileSync(owner, 'utf8') === JSON.stringify({ token: state.token, site: state.site }),
		'Seed ownership token mismatch'
	);
	return state;
}
function seedFiles(state: State) {
	const cache = path.join(state.directory, 'cache');
	noLinks(cache);
	const found: string[] = [];
	let bytes = 0;
	function walk(directory: string) {
		noLinks(directory);
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const file = path.join(directory, entry.name);
			noLinks(file);
			if (entry.isDirectory()) walk(file);
			else {
				insist(entry.isFile(), 'Seed must contain only regular files');
				found.push(path.relative(cache, file).split(path.sep).join('/'));
				bytes += lstatSync(file).size;
			}
		}
	}
	walk(cache);
	insist(
		JSON.stringify(found.sort()) === JSON.stringify([...state.files].sort()) &&
			bytes === state.bytes,
		'Seed inventory changed'
	);
	insist(seedContentHash(cache, state.files) === state.seedContentSha256, 'Seed content changed');
	return cache;
}
function planReset(state: State) {
	const tracked = git(state.site, ['ls-files', '--cached', '-z', '--', '.'])
		.split('\0')
		.filter(Boolean);
	for (const target of targets) {
		noLinks(path.join(state.site, target));
		insist(
			!tracked.some((file) => file === target || file.startsWith(target + '/')),
			'Refusing to remove a maintained tracked file'
		);
	}
	const maintained = git(state.site, [
		'ls-files',
		'--cached',
		'--others',
		'--exclude-standard',
		'-z',
		'--',
		'static'
	])
		.split('\0')
		.filter(Boolean);
	const remove: string[] = [];
	const walk = (directory: string) => {
		const absolute = path.join(state.site, directory);
		noLinks(absolute);
		if (!lstatSync(absolute, { throwIfNoEntry: false })) return;
		insist(lstatSync(absolute).isDirectory(), 'Static root must be a real directory');
		for (const entry of readdirSync(absolute, { withFileTypes: true })) {
			const file = `${directory}/${entry.name}`;
			noLinks(path.join(state.site, file));
			if (maintained.includes(file)) continue;
			if (entry.isDirectory() && maintained.some((name) => name.startsWith(file + '/'))) walk(file);
			else {
				insist(
					!maintained.some((name) => name === file || name.startsWith(file + '/')),
					'Refusing to remove maintained static files'
				);
				remove.push(path.join(state.site, file));
			}
		}
	};
	walk('static');
	return [...targets.map((target) => path.join(state.site, target)), ...remove];
}

const [command, ...args] = process.argv.slice(2);
insist(['capture', 'reset', 'cleanup'].includes(command), 'Use capture, reset, or cleanup');
insist(
	args.length === 4 && args[0] === '--site' && args[2] === '--state-file',
	'Usage: <command> --site /absolute/repo/site --state-file /private/temp/state.json'
);
const site = args[1],
	stateFile = args[3];
const repository = validateSite(site);
noLinks(stateFile);
insist(!within(repository, stateFile), 'State file must stay outside the repository');
if (command === 'capture') {
	insist(!lstatSync(stateFile, { throwIfNoEntry: false }), 'State file already exists');
	noLinks(path.dirname(stateFile));
	insist(lstatSync(path.dirname(stateFile)).isDirectory(), 'State parent must exist');
	const source = path.join(site, 'build/generated/cache');
	noLinks(source);
	insist(lstatSync(source).isDirectory(), 'Prime the compiler cache before capture');
	const { compilerCacheFiles } = await import(
		pathToFileURL(path.join(site, 'tooling/lib/cache-selection.ts')).href
	);
	const files: string[] = compilerCacheFiles(source);
	insist(files.length > 0, 'Cannot capture an empty compiler seed');
	files.forEach(validRelative);
	for (const file of files) {
		noLinks(path.join(source, file));
		insist(lstatSync(path.join(source, file)).isFile(), 'Seed source must be regular');
	}
	const tempRoot = realpathSync(os.tmpdir());
	noLinks(tempRoot);
	const directory = mkdtempSync(path.join(tempRoot, 'wisconsin-controlled-seed-'), {
		encoding: 'utf8'
	});
	let stateWritten = false;
	try {
		// mkdtemp creates mode0700; assert rather than assume platform ownership semantics.
		const info = lstatSync(directory);
		insist((info.mode & 0o077) === 0, 'Seed directory must be private');
		const token = randomBytes(32).toString('hex');
		writeFileSync(path.join(directory, 'owner.json'), JSON.stringify({ token, site }), {
			mode: 0o600,
			flag: 'wx'
		});
		let bytes = 0;
		mkdirSync(path.join(directory, 'cache'));
		for (const file of files) {
			const destination = path.join(directory, 'cache', file);
			mkdirSync(path.dirname(destination), { recursive: true });
			cpSync(path.join(source, file), destination, {
				mode: constants.COPYFILE_FICLONE,
				preserveTimestamps: true
			});
			bytes += lstatSync(destination).size;
		}
		const state: State = {
			version: 1,
			site,
			repository,
			directory,
			token,
			device: info.dev,
			inode: info.ino,
			files,
			bytes,
			selectionSha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
			seedContentSha256: seedContentHash(path.join(directory, 'cache'), files)
		};
		writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
		stateWritten = true;
		console.log(
			JSON.stringify({
				operation: 'capture',
				files: files.length,
				bytes,
				selectionSha256: state.selectionSha256,
				seedContentSha256: state.seedContentSha256
			})
		);
	} finally {
		if (!stateWritten) rmSync(directory, { recursive: true, force: true });
	}
} else {
	const state = readState(stateFile);
	insist(state.site === site, 'State belongs to another site');
	if (command === 'cleanup') {
		rmSync(state.directory, { recursive: true });
		rmSync(stateFile);
		console.log(JSON.stringify({ operation: 'cleanup', success: true }));
	} else {
		const seed = seedFiles(state);
		const remove = planReset(state); // Validate everything before the first destructive operation.
		for (const file of remove) rmSync(file, { recursive: true, force: true });
		const destination = path.join(site, 'build/generated/cache');
		noLinks(destination);
		mkdirSync(path.dirname(destination), { recursive: true });
		cpSync(seed, destination, {
			recursive: true,
			mode: constants.COPYFILE_FICLONE,
			preserveTimestamps: true
		});
		console.log(
			JSON.stringify({
				operation: 'reset',
				files: state.files.length,
				bytes: state.bytes,
				selectionSha256: state.selectionSha256,
				seedContentSha256: state.seedContentSha256,
				staticPolicy:
					'Preserved Git tracked and untracked maintained files; pruned ignored generated files'
			})
		);
	}
}
