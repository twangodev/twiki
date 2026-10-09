import { execFileSync } from 'node:child_process';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';

export interface ContentRepository {
	directory: string;
	head: string;
	gitDirectory: string;
	commonDirectory: string;
	index: string;
	config: string;
	worktreeConfig: string;
	tracked: Buffer;
}

/** Read local Git metadata; never initialize submodules or fetch remote content. */
export function contentGit(...args: string[]) {
	return execFileSync('git', args, { maxBuffer: 128 * 1024 * 1024 });
}

/** Course directories declared by the root, matching compiler discovery without loading renderers. */
export function declaredCourseDirectories(repo: string): string[] {
	const root = path.resolve(repo);
	const directories: string[] = [];
	const modules = path.join(root, '.gitmodules');
	if (existsSync(modules)) {
		let declared: Buffer;
		try {
			declared = contentGit(
				'-C',
				root,
				'config',
				'-z',
				'--file',
				modules,
				'--get-regexp',
				'^submodule\\..*\\.path$'
			);
		} catch (error) {
			// A valid file with no submodule paths has no matching config entries.
			if ((error as { status?: number }).status !== 1) throw error;
			declared = Buffer.alloc(0);
		}
		for (const entry of declared.toString().split('\0').filter(Boolean)) {
			const course = entry.slice(entry.indexOf('\n') + 1);
			if (!course.startsWith('content/')) continue;
			directories.push(path.resolve(root, course));
		}
	}
	return directories;
}

/** Follow initialized declared courses and indexed gitlinks, including nested projects. */
export function contentRepositories(repo: string): ContentRepository[] {
	const root = path.resolve(repo);
	const pending = [
		root,
		...declaredCourseDirectories(root).filter((directory) =>
			existsSync(path.join(directory, '.git'))
		)
	];
	const repositories: ContentRepository[] = [];
	const visited = new Set<string>();
	for (let position = 0; position < pending.length; position++) {
		const directory = pending[position];
		if (visited.has(directory)) continue;
		visited.add(directory);
		const [gitDirectory, commonDirectory, index, config, worktreeConfig, head] = contentGit(
			'-C',
			directory,
			'rev-parse',
			'--path-format=absolute',
			'--git-dir',
			'--git-common-dir',
			'--git-path',
			'index',
			'--git-path',
			'config',
			'--git-path',
			'config.worktree',
			'HEAD'
		)
			.toString()
			.trimEnd()
			.split('\n');
		const tracked = contentGit(
			'-C',
			directory,
			'ls-files',
			'-z',
			'--stage',
			...(directory === root ? ['--', 'content'] : [])
		);
		repositories.push({
			directory,
			head,
			gitDirectory,
			commonDirectory,
			index,
			config,
			worktreeConfig,
			tracked
		});
		for (const entry of tracked.toString().split('\0')) {
			if (!entry.startsWith('160000 ')) continue;
			const file = entry.slice(entry.indexOf('\t') + 1);
			const nested = path.join(directory, file);
			if (existsSync(path.join(nested, '.git'))) pending.push(nested);
		}
	}
	return repositories;
}

type GitDirectoryWatch = (
	directory: string,
	options: { recursive: boolean },
	listener: (event: string, file: string | Buffer | null) => void
) => FSWatcher;

/** Missing metadata directories can race removal; resource or permission failures must remain visible. */
export function watchContentGitDirectory(
	directory: string,
	recursive: boolean,
	files: () => Set<string>,
	invalidate: () => void,
	watchDirectory: GitDirectoryWatch = watch
) {
	try {
		return watchDirectory(directory, { recursive }, (_event, file) => {
			// Node may omit the filename, so conservatively reconcile the repository.
			if (file === null || recursive || files().has(String(file))) invalidate();
		});
	} catch (error) {
		if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
	}
}
