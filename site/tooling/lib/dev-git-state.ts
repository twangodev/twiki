import { execFile } from 'node:child_process';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import {
	resolveProject,
	declaredContentCourses,
	gitAvailable,
	contentWithinProject
} from './project-config';

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
	return new Promise<Buffer>((resolve, reject) => {
		execFile('git', args, { encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 }, (error, stdout) => {
			if (error) reject(error);
			else resolve(stdout);
		});
	});
}

/** Course directories declared by the root, matching compiler discovery without loading renderers. */
export function declaredCourseDirectories(repo: string): string[] {
	return declaredContentCourses(resolveProject(process.cwd(), repo)).map(
		(course) => course.directory
	);
}

/** Finish all reads before surfacing a failure, including sibling subprocesses. */
async function readAll<T>(reads: Promise<T>[]): Promise<T[]> {
	const results = await Promise.allSettled(reads);
	return results.map((result) => {
		if (result.status === 'rejected') throw result.reason;
		return result.value;
	});
}

async function readRepository(
	directory: string,
	root: string,
	content: string
): Promise<ContentRepository> {
	const metadataArgs = [
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
		'config.worktree'
	];
	const metadata = contentGit(...metadataArgs, '--verify', '--quiet', 'HEAD').catch((error) => {
		if (error.code !== 1) throw error;
		// Empty repositories still have paths and tracked content, but no HEAD.
		return contentGit(...metadataArgs);
	});
	const [details, tracked] = await readAll([
		metadata,
		contentGit(
			'-C',
			directory,
			'ls-files',
			'-z',
			'--stage',
			...(directory === root ? ['--', path.relative(root, content) || '.'] : [])
		)
	]);
	const [gitDirectory, commonDirectory, index, config, worktreeConfig, head = 'unborn'] = details
		.toString()
		.trimEnd()
		.split('\n');
	return { directory, head, gitDirectory, commonDirectory, index, config, worktreeConfig, tracked };
}

/** Follow initialized courses and indexed gitlinks, with at most four repositories being read. */
export async function contentRepositories(repo: string): Promise<ContentRepository[]> {
	const project = resolveProject(process.cwd(), repo);
	if (project.discovery !== 'git') return [];
	const root = path.resolve(repo);
	const pending = [
		...new Set([
			...(contentWithinProject(project) && gitAvailable(root)
				? [root]
				: gitAvailable(project.contentDir)
					? [project.contentDir]
					: []),
			...declaredCourseDirectories(root).filter((directory) =>
				existsSync(path.join(directory, '.git'))
			)
		])
	];
	const repositories: ContentRepository[] = [];
	const queued = new Set(pending);
	for (let position = 0; position < pending.length; ) {
		const batch = pending.slice(position, position + 4);
		position += batch.length;
		const captured = await readAll(
			batch.map((directory) => readRepository(directory, root, project.contentDir))
		);
		for (const repository of captured) {
			repositories.push(repository);
			for (const entry of repository.tracked.toString().split('\0')) {
				if (!entry.startsWith('160000 ')) continue;
				const nested = path.join(repository.directory, entry.slice(entry.indexOf('\t') + 1));
				if (!queued.has(nested) && existsSync(path.join(nested, '.git'))) {
					queued.add(nested);
					pending.push(nested);
				}
			}
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
