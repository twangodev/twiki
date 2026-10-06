import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
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
	'LD_LIBRARY_PATH'
] as const;
const probes = new Map<string, string>();

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
				'cat(R.version.string); for (p in c("knitr", "evaluate", "highr", "xfun", "yaml")) cat(p, as.character(packageVersion(p)))'
			],
			{ env: environment, encoding: 'utf8', timeout: 30_000, stdio: 'pipe' }
		);
		probes.set(key, version);
		return version;
	} catch (error) {
		probes.delete(key);
		throw new Error(
			'R Markdown previews require R and knitr. Install r-base-core and r-cran-knitr (see site/README.md).',
			{ cause: error }
		);
	}
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
