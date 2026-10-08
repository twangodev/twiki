import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { contentGit, declaredCourseDirectories } from './dev-git-state';

const runtimeEnvironment = [
	'PATH',
	'R_HOME',
	'RHOME',
	'R_LIBS',
	'R_LIBS_SITE',
	'R_LIBS_USER',
	'R_ENVIRON',
	'R_ENVIRON_USER',
	'R_PROFILE',
	'R_PROFILE_USER',
	'LD_LIBRARY_PATH',
	'FONTCONFIG_PATH',
	'FONTCONFIG_FILE',
	'FONTCONFIG_SYSROOT',
	'FC_LANG',
	'XDG_CONFIG_HOME',
	'XDG_DATA_HOME'
] as const;
const probes = new Map<string, string>();
const unavailableFontIdentity = randomBytes(16).toString('hex');

/** Font paths locate inputs; only portable face metadata and content hashes enter the identity. */
export function rFontIdentity(environment: NodeJS.ProcessEnv = process.env) {
	const deadline = performance.now() + 5_000;
	const maximumBytes = 256 * 1024 * 1024;
	let bytes = 0;
	const hashes = new Map<string, string>();
	const hashFile = (file: string, maximumSize: number) => {
		if (hashes.has(file)) return hashes.get(file)!;
		const info = statSync(file);
		if (
			!info.isFile() ||
			info.size > maximumSize ||
			bytes + info.size > maximumBytes ||
			hashes.size >= 512 ||
			performance.now() >= deadline
		)
			throw new Error('Font identity exceeds its probe budget');
		const content = readFileSync(file);
		bytes += content.length;
		const hash = createHash('sha256').update(content).digest('hex');
		hashes.set(file, hash);
		return hash;
	};
	const run = (command: string, args: string[]) => {
		const remaining = Math.floor(deadline - performance.now());
		if (remaining < 1) throw new Error('Font identity probe timed out');
		return execFileSync(command, args, {
			env: environment,
			encoding: 'utf8',
			timeout: Math.min(2_000, remaining),
			maxBuffer: 1024 * 1024,
			stdio: ['ignore', 'pipe', 'pipe']
		});
	};
	const format =
		'%{file}\t%{family}\t%{style}\t%{fontversion}\t%{foundry}\t%{index}\t%{antialias}\t%{hinting}\t%{hintstyle}\t%{rgba}\n';
	const faces = (output: string) =>
		[
			...new Set(
				output
					.split('\n')
					.filter(Boolean)
					.map((line) => {
						const [file, ...metadata] = line.split('\t');
						if (!file || metadata.length !== 9) throw new Error('Invalid resolved font metadata');
						return JSON.stringify([metadata, hashFile(file, 64 * 1024 * 1024)]);
					})
			)
		].sort();
	try {
		const inventory = faces(run('fc-list', ['--format', format]));
		if (!inventory.length) throw new Error('Font inventory is empty');
		const matches = [];
		for (const family of ['', 'sans', 'serif', 'monospace', 'symbol']) {
			for (const style of ['', 'Bold', 'Italic', 'Bold Italic']) {
				const pattern = family + (style ? `:style=${style}` : '');
				const resolved = faces(run('fc-match', ['--format', format, pattern]));
				if (!resolved.length) throw new Error('Default font cannot be resolved');
				matches.push([pattern, resolved]);
			}
		}
		const configuration = run('fc-conflist', [])
			.split('\n')
			.filter((line) => line.startsWith('+ '))
			.map((line) => {
				const separator = line.indexOf(': ', 2);
				if (separator < 0) throw new Error('Invalid active font configuration');
				return hashFile(line.slice(2, separator), 1024 * 1024);
			});
		if (performance.now() >= deadline) throw new Error('Font identity probe timed out');
		return (
			'fontconfig-v1:' +
			createHash('sha256')
				.update(JSON.stringify([inventory, matches, configuration]))
				.digest('hex')
		);
	} catch {
		// R can use native devices without Fontconfig tools. Render normally, but
		// previews bypass cache reads, while the process identity keeps source guards stable.
		return `fontconfig-unverified-v1:${process.platform}:${unavailableFontIdentity}`;
	}
}

function selection(environment: NodeJS.ProcessEnv) {
	const executable = environment.RSCRIPT ?? 'Rscript';
	const locations = executable.includes(path.sep)
		? [path.resolve(executable)]
		: (environment.PATH ?? '')
				.split(path.delimiter)
				.map((directory) => path.resolve(directory, executable));
	const binary = locations.find(existsSync);
	let metadata: unknown;
	if (binary) {
		try {
			const info = statSync(binary);
			metadata = [binary, info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs];
		} catch (error) {
			if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
		}
	}
	return JSON.stringify([
		executable,
		runtimeEnvironment.map((name) => [name, environment[name]]),
		metadata
	]);
}

/** Share the version probe with rendering, but refresh before accepting a saved dev snapshot. */
export function rRuntimeVersion(environment: NodeJS.ProcessEnv = process.env, refresh = false) {
	const key = selection(environment);
	if (!refresh && probes.has(key)) return probes.get(key)!;
	try {
		const version = execFileSync(
			environment.RSCRIPT ?? 'Rscript',
			[
				'--vanilla',
				'-e',
				'cat(R.version.string); for (p in c("knitr", "evaluate", "highr", "xfun", "yaml")) cat(p, as.character(packageVersion(p))); cat("\\n"); dput(R.version); dput(capabilities()); dput(extSoftVersion()); dput(grDevices::grSoftVersion()); dput(Sys.getlocale()); dput(Sys.timezone()); packages <- utils::installed.packages(); packages <- packages[order(packages[, "Package"], packages[, "Version"], packages[, "Built"]), c("Package", "Version", "Built"), drop = FALSE]; cat("\\n", apply(packages, 1, paste, collapse = " "), sep = "\\n")'
			],
			{ env: environment, encoding: 'utf8', timeout: 30_000, stdio: 'pipe' }
		);
		const identity = `${version}\n${rFontIdentity(environment)}`;
		probes.set(key, identity);
		return identity;
	} catch (error) {
		probes.delete(key);
		throw new Error(
			'R Markdown previews require R and knitr. Install r-base-core and r-cran-knitr (see site/README.md).',
			{ cause: error }
		);
	}
}

export interface RRenderProfile {
	schemaVersion: 1;
	platform: string;
	architecture: string;
	runtime: string;
	runtimeSha256: string;
}

/** Capture only dependency/device/version provenance from an actual renderer, never note data. */
export function captureRRenderProfile(
	environment: NodeJS.ProcessEnv = process.env
): RRenderProfile {
	return renderProfile(rRuntimeVersion(environment, true));
}

function renderProfile(runtime: string): RRenderProfile {
	const separator = runtime.lastIndexOf('\nfontconfig-');
	if (separator < 0) throw new Error('Missing renderer font provenance');
	const versions = runtime.slice(0, separator);
	const platform = process.platform;
	const architecture = process.arch;
	return {
		schemaVersion: 1,
		platform,
		architecture,
		runtime: versions,
		runtimeSha256: createHash('sha256')
			.update(JSON.stringify(['r-render-profile-v1', platform, architecture, versions]))
			.digest('hex')
	};
}

export function readRRenderProfile(site: string, environment: NodeJS.ProcessEnv = process.env) {
	const file = path.resolve(
		environment.WISCONSIN_R_RENDER_PROFILE_FILE ?? path.join(site, 'tooling/r-render-profile.json')
	);
	if (!existsSync(file)) return;
	if (!lstatSync(file).isFile() || realpathSync(file) !== file)
		throw new Error('R render profile must be an owned regular lock file');
	const value: RRenderProfile = JSON.parse(readFileSync(file, 'utf8'));
	if (
		value.schemaVersion !== 1 ||
		value.platform !== process.platform ||
		value.architecture !== process.arch ||
		typeof value.runtime !== 'string' ||
		!value.runtime ||
		!/^[a-f0-9]{64}$/.test(value.runtimeSha256) ||
		renderProfile(`${value.runtime}\nfontconfig-v1:unused`).runtimeSha256 !== value.runtimeSha256
	)
		throw new Error('Invalid or incompatible R render profile lock');
	return value;
}

/** A provisioned renderer must match the maintained lock, rather than silently updating policy. */
export function verifyRRenderProfile(
	site: string,
	runtime: string,
	environment: NodeJS.ProcessEnv = process.env
) {
	if (environment.WISCONSIN_R_CACHE_ONLY !== '1' && environment.WISCONSIN_R_REQUIRE_PROFILE !== '1')
		return;
	const expected = readRRenderProfile(site, environment);
	if (!expected) throw new Error('A verified R render profile lock is required by this build');
	if (expected && renderProfile(runtime).runtimeSha256 !== expected.runtimeSha256)
		throw new Error(
			'Installed R renderer does not match tooling/r-render-profile.json; provision the locked dependencies or explicitly update the verified lock'
		);
}

/** Reconstruct an approved identity only from the maintained lock and independently observed fonts. */
export function lockedRRuntime(site: string, environment: NodeJS.ProcessEnv = process.env) {
	const profile = readRRenderProfile(site, environment);
	if (!profile) throw new Error('R cache-only reuse requires a verified render profile lock');
	const fonts = rFontIdentity(environment);
	if (!/^fontconfig-v1:[a-f0-9]{64}$/.test(fonts))
		throw new Error('R cache-only reuse requires independently verified fonts');
	return `${profile.runtime}\n${fonts}`;
}

/** Probe conservatively for indexed worksheets in declared, initialized courses. */
export function rRendererIdentity(repo: string, environment: NodeJS.ProcessEnv = process.env) {
	const courses = declaredCourseDirectories(repo);
	const indexed = contentGit('-C', repo, 'ls-files', '-z', '--recurse-submodules', '--', 'content')
		.toString()
		.split('\0');
	let hasWorksheet = indexed.some((file) => {
		if (!/\.rmd$/i.test(file)) return false;
		const source = path.resolve(repo, file);
		return courses.some((course) => source.startsWith(course + path.sep)) && existsSync(source);
	});
	// Compiler discovery also includes initialized declared courses before their gitlink is staged.
	// The root query covers ordinary registered courses, avoiding a Git process for each one.
	if (!hasWorksheet) {
		for (const course of courses) {
			const relative = path.relative(path.resolve(repo), course).split(path.sep).join('/') + '/';
			if (
				!existsSync(path.join(course, '.git')) ||
				indexed.some((file) => file.startsWith(relative))
			)
				continue;
			const files = contentGit('-C', course, 'ls-files', '-z', '--recurse-submodules')
				.toString()
				.split('\0');
			if (files.some((file) => /\.rmd$/i.test(file) && existsSync(path.resolve(course, file)))) {
				hasWorksheet = true;
				break;
			}
		}
	}
	if (!hasWorksheet) return 'unused';
	let version: string | null;
	try {
		version = rRuntimeVersion(environment, true);
	} catch {
		version = null;
	}
	return JSON.stringify([selection(environment), version]);
}
