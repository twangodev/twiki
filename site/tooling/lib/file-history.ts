import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import type { CourseFile } from '../../src/lib/files';
import type { FileBlame, FileChange, FileCommit, FileHistory } from '../../src/lib/file-history';

const historyVersion = '1';
const maxAssetBytes = 25 * 1024 * 1024;

export function parseBlame(output: string): FileBlame {
	const commits: Record<string, FileCommit> = {};
	const ranges: FileBlame['ranges'] = [];
	let commit: FileCommit | undefined;
	for (const line of output.split('\n')) {
		const header = /^([a-f0-9]{40,64}) \d+ (\d+) (\d+)$/.exec(line);
		if (header) {
			const [, id, start, count] = header;
			commit = commits[id] ??= { id, author: '', date: '', subject: '' };
			ranges.push([Number(start), Number(start) + Number(count) - 1, id]);
		} else if (commit) {
			if (line.startsWith('author ')) commit.author = line.slice(7);
			else if (line.startsWith('author-time '))
				commit.date = new Date(Number(line.slice(12)) * 1000).toISOString();
			else if (line.startsWith('summary ')) commit.subject = line.slice(8);
		}
	}
	ranges.sort((a, b) => a[0] - b[0]);
	return { commits, ranges };
}

export function createFileHistoryBuilder(
	repo: string,
	output: string,
	cache: string,
	allowed: (file: string) => boolean,
	policyKey = allowed.toString()
) {
	if (!existsSync(path.join(repo, '.git'))) return;
	const git = (...args: string[]) =>
		execFileSync('git', ['-C', repo, ...args], { maxBuffer: 128 * 1024 * 1024, encoding: 'utf8' });
	const revision = git('rev-parse', 'HEAD').trim();
	if (git('rev-parse', '--is-shallow-repository').trim() === 'true')
		throw new Error(`Full Git history required: ${repo}`);
	mkdirSync(cache, { recursive: true });
	mkdirSync(path.join(output, 'history'), { recursive: true });
	const commits = new Map<string, { commit: FileCommit; parent?: string; changes: string[] }>();
	function details(id: string) {
		let cached = commits.get(id);
		if (cached) return cached;
		const [author, date, subject, parents] = git(
			'show',
			'-s',
			'--format=%an%x00%aI%x00%s%x00%P',
			id
		)
			.trimEnd()
			.split('\0');
		const parent = parents?.split(' ')[0] || undefined;
		const changes = (
			parent
				? git('diff', '--name-status', '-z', '-M', parent, id)
				: git('diff-tree', '--root', '-r', '--name-status', '-z', '--no-commit-id', id)
		).split('\0');
		cached = { commit: { id, author, date, subject }, parent, changes };
		commits.set(id, cached);
		return cached;
	}
	function publish(name: string, data?: unknown) {
		const target = path.join(cache, name);
		if (data !== undefined) {
			const serialized = typeof data === 'string' ? data : JSON.stringify(data);
			if (Buffer.byteLength(serialized) > maxAssetBytes) return;
			writeFileSync(target, serialized);
		}
		copyFileSync(target, path.join(output, 'history', name));
		return `/_files/history/${name}`;
	}
	return (file: CourseFile, bytes: Uint8Array) => {
		const key = createHash('sha256')
			.update(`${historyVersion}\0${policyKey}\0${revision}\0${file.path}\0`)
			.update(bytes)
			.digest('hex');
		const name = `${key}.json`;
		const cached = path.join(cache, name);
		if (existsSync(cached)) {
			const history: FileHistory = JSON.parse(readFileSync(cached, 'utf8'));
			if (
				history.commits.every(
					(commit) => allowed(commit.path) && (!commit.previousPath || allowed(commit.previousPath))
				)
			) {
				for (const url of [history.blame, ...history.commits.map((commit) => commit.diff)])
					if (url) publish(path.basename(url));
				return publish(name);
			}
		}
		const history: FileHistory = { revision, commits: [] };
		const workingBlob = execFileSync('git', ['-C', repo, 'hash-object', '--stdin'], {
			input: bytes,
			encoding: 'utf8'
		}).trim();
		const committedBlob = git('ls-tree', '-z', revision, '--', file.path)
			.split('\t')[0]
			?.split(' ')[2];
		const clean = workingBlob === committedBlob;
		if (!clean)
			history.notice =
				'Working copy differs from the committed file. Blame is unavailable; history shows committed changes only.';
		let currentPath = file.path;
		let restricted = false;
		for (const id of git(
			'log',
			'--follow',
			'--first-parent',
			'--format=%H',
			revision,
			'--',
			file.path
		)
			.trim()
			.split('\n')
			.filter(Boolean)) {
			const { commit, parent, changes } = details(id);
			let previousPath = currentPath;
			let added = false;
			for (let i = 0; i < changes.length; ) {
				const status = changes[i++];
				const before = changes[i++];
				const after = /^[RC]/.test(status) ? changes[i++] : before;
				if (after !== currentPath) continue;
				if (status.startsWith('R')) previousPath = before;
				added = status === 'A';
			}
			const change: FileChange = { ...commit, path: currentPath };
			if (previousPath !== currentPath) change.previousPath = previousPath;
			if (!allowed(previousPath)) {
				delete change.previousPath;
				change.unavailable = 'Earlier history belongs to an excluded path.';
				history.commits.push(change);
				restricted = true;
				break;
			}
			if (parent && !added) {
				const diff = git(
					'diff',
					'--no-ext-diff',
					'--no-textconv',
					'--no-color',
					'-M',
					parent,
					id,
					'--',
					previousPath,
					currentPath
				);
				if (
					/-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/.test(
						diff
					)
				) {
					change.unavailable = 'This change contains a potential credential and was not exported.';
				} else {
					change.diff = publish(`${key}-${id}.diff`, diff);
					if (!change.diff) change.unavailable = 'This diff exceeds the hosting size limit.';
				}
			} else change.unavailable = 'Initial version. No earlier version to compare.';
			history.commits.push(change);
			currentPath = previousPath;
			if (added) break;
		}
		if (restricted) history.notice = 'History stops at an excluded path. Blame is unavailable.';
		if (clean && !restricted && file.kind === 'text') {
			const blame = parseBlame(git('blame', '--incremental', '--root', revision, '--', file.path));
			history.blame = publish(`${key}-blame.json`, blame);
		}
		return publish(name, history);
	};
}
