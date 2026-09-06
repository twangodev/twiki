import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface SubmoduleInfo {
	path: string;
	fullPath: string;
}

export function parseGitmodules(gitmodulesPath: string): SubmoduleInfo[] {
	try {
		const content = fs.readFileSync(gitmodulesPath, 'utf8');
		const submodules: SubmoduleInfo[] = [];
		const lines = content.split('\n');
		let currentPath = '';

		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.startsWith('path = ')) {
				currentPath = trimmed.substring(7).trim();
				if (currentPath) {
					submodules.push({
						path: currentPath,
						fullPath: path.resolve(path.dirname(gitmodulesPath), currentPath)
					});
				}
			}
		}
		return submodules.sort((a, b) => b.fullPath.length - a.fullPath.length);
	} catch {
		return [];
	}
}

function git(repo: string, args: string[], maxBuffer = 1024 * 1024 * 512): string {
	return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer });
}

export function repositoryDates(repoDir: string): GitDateMap {
	const out = git(repoDir, [
		'-c',
		'core.quotepath=false',
		'log',
		'--reverse',
		'-m',
		'--first-parent',
		'--format=%H %ct',
		'--name-status',
		'-M'
	]);
	const dates: GitDateMap = { created: {}, modified: {} };
	let currentEpoch: number | null = null;
	for (const line of out.split('\n')) {
		if (line === '') continue;
		const m = line.match(/^[0-9a-f]{40} (\d+)$/);
		if (m) {
			currentEpoch = Number(m[1]);
			continue;
		}
		const [status, file, renamed] = line.split('\t');
		if (currentEpoch === null || !file) continue;
		if (status.startsWith('R') && renamed) {
			dates.created[renamed] = dates.created[file] ?? currentEpoch;
			dates.modified[renamed] = currentEpoch;
			delete dates.created[file];
			delete dates.modified[file];
		} else if (status === 'D') {
			delete dates.created[file];
			delete dates.modified[file];
		} else {
			if (status === 'A' || dates.created[file] === undefined) dates.created[file] = currentEpoch;
			dates.modified[file] = currentEpoch;
		}
	}
	return dates;
}

function headSha(repoDir: string): string {
	return git(repoDir, ['rev-parse', 'HEAD']).trim();
}

export interface GitDateMap {
	created: Record<string, number>;
	modified: Record<string, number>;
}

export function buildGitDateMap(repoRoot: string, cacheDir: string): GitDateMap {
	fs.mkdirSync(cacheDir, { recursive: true });
	const submodules = parseGitmodules(path.join(repoRoot, '.gitmodules')).filter((s) =>
		s.path.startsWith('content/')
	);

	const created: Record<string, number> = {};
	const modified: Record<string, number> = {};

	const loadRepo = (repoDir: string, cacheKey: string): GitDateMap => {
		let head: string;
		try {
			head = headSha(repoDir);
		} catch {
			return { created: {}, modified: {} };
		}
		const cacheFile = path.join(cacheDir, `gitdates-v2-${cacheKey}-${head}.json`);
		if (fs.existsSync(cacheFile)) {
			try {
				return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
			} catch {
				/* fall through to rebuild */
			}
		}
		const dates = repositoryDates(repoDir);
		for (const f of fs.readdirSync(cacheDir)) {
			if (f.startsWith(`gitdates-v2-${cacheKey}-`)) fs.rmSync(path.join(cacheDir, f));
		}
		fs.writeFileSync(cacheFile, JSON.stringify(dates));
		return dates;
	};
	for (const sub of submodules) {
		const name = sub.path.slice('content/'.length);
		if (!fs.existsSync(path.join(sub.fullPath, '.git'))) continue;
		const dates = loadRepo(sub.fullPath, name);
		for (const [p, epoch] of Object.entries(dates.modified)) {
			modified[`${name}/${p}`] = epoch;
			created[`${name}/${p}`] = dates.created[p];
		}
	}
	const superDates = loadRepo(repoRoot, 'superproject');
	for (const [p, epoch] of Object.entries(superDates.modified)) {
		if (p.startsWith('content/')) {
			const rel = p.slice('content/'.length);
			if (
				!submodules.some(
					(s) =>
						rel === s.path.slice('content/'.length) ||
						rel.startsWith(s.path.slice('content/'.length) + '/')
				)
			) {
				modified[rel] = epoch;
				created[rel] = superDates.created[p];
			}
		}
	}

	return { created, modified };
}

export function coerceDate(
	file: string,
	value: unknown,
	warn?: (message: string) => void
): Date | undefined {
	if (value === undefined || value === null || value === '') return;
	const dateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
	const supported =
		value instanceof Date ||
		typeof value === 'number' ||
		(typeof value === 'string' &&
			(dateOnly || /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)));
	const date = supported ? new Date(value as string | number) : new Date(NaN);
	if (
		!Number.isFinite(date.getTime()) ||
		date.getTime() > Date.now() ||
		(dateOnly && date.toISOString().slice(0, 10) !== value)
	) {
		warn?.(`${file}: ignored invalid or future date ${String(value)}`);
		return;
	}
	return date;
}

export function resolveDates({
	relativePath,
	frontmatter,
	gitDates,
	warn
}: {
	relativePath: string;
	frontmatter: Record<string, unknown>;
	gitDates: GitDateMap;
	warn?: (message: string) => void;
}) {
	const fromGit = (kind: 'created' | 'modified') => {
		const epoch = gitDates[kind][relativePath];
		return epoch === undefined ? undefined : coerceDate(relativePath, epoch * 1000, warn);
	};
	const created = coerceDate(relativePath, frontmatter.created, warn) ?? fromGit('created');
	const modified = coerceDate(relativePath, frontmatter.modified, warn) ?? fromGit('modified');
	const published = coerceDate(relativePath, frontmatter.published, warn);
	return { created, modified, published };
}
