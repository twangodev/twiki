/**
 * Submodule-aware git modification dates.
 *
 * Ported from the wisconsin Quartz fork's `quartz/plugins/transformers/lastmod.ts`
 * design (parse .gitmodules, map file -> owning repo, ask that repo for the file's
 * latest commit date), but implemented as ONE batched
 * `git -C <repo> log --format=%H %ct --name-only` walk per repository instead of
 * one subprocess per file (@napi-rs/simple-git did the per-file walk in-process).
 *
 * Results are cached under site/.generated/cache/ keyed on the repo's HEAD sha;
 * a submodule that hasn't moved costs one `rev-parse` on rebuild.
 *
 * Date priority (same as quartz.config.ts CreatedModifiedDate):
 *   frontmatter -> git (modified only) -> filesystem.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface SubmoduleInfo {
	/** path relative to the repo root, e.g. "content/sp26-cs537" */
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

		// Sort by path length (longest first) for accurate prefix matching
		return submodules.sort((a, b) => b.fullPath.length - a.fullPath.length);
	} catch {
		return [];
	}
}

function git(repo: string, args: string[], maxBuffer = 1024 * 1024 * 512): string {
	return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer });
}

/**
 * One `git log --format=%H %ct --name-only` walk over a repository.
 * Returns repo-relative path -> last-modified epoch seconds (first/newest mention wins).
 * Rename note: like the fork's simple-git walk, a rename counts as a modification
 * of the new path.
 */
function walkRepoLog(repoDir: string): Record<string, number> {
	// -m --first-parent: merge commits diff against their first parent so files
	// that only ever land via merges (common in these submodules) still get dates
	const out = git(repoDir, ['log', '-m', '--first-parent', '--format=%H %ct', '--name-only']);
	const dates: Record<string, number> = {};
	let currentEpoch: number | null = null;
	for (const line of out.split('\n')) {
		if (line === '') continue;
		const m = line.match(/^[0-9a-f]{40} (\d+)$/);
		if (m) {
			currentEpoch = Number(m[1]);
			continue;
		}
		if (currentEpoch !== null && dates[line] === undefined) {
			dates[line] = currentEpoch;
		}
	}
	return dates;
}

function headSha(repoDir: string): string {
	return git(repoDir, ['rev-parse', 'HEAD']).trim();
}

export interface GitDateMap {
	/** path relative to content/ -> last-modified epoch seconds */
	modified: Record<string, number>;
}

/**
 * Build the content-relative path -> last-modified-epoch map for the whole corpus.
 * @param repoRoot   superproject root (contains .gitmodules and content/)
 * @param cacheDir   directory for HEAD-keyed cache files
 */
export function buildGitDateMap(repoRoot: string, cacheDir: string): GitDateMap {
	fs.mkdirSync(cacheDir, { recursive: true });
	const submodules = parseGitmodules(path.join(repoRoot, '.gitmodules')).filter((s) =>
		s.path.startsWith('content/')
	);

	const modified: Record<string, number> = {};

	const loadRepo = (repoDir: string, cacheKey: string): Record<string, number> => {
		let head: string;
		try {
			head = headSha(repoDir);
		} catch {
			return {};
		}
		const cacheFile = path.join(cacheDir, `gitdates-${cacheKey}-${head}.json`);
		if (fs.existsSync(cacheFile)) {
			try {
				return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
			} catch {
				/* fall through to rebuild */
			}
		}
		const dates = walkRepoLog(repoDir);
		// drop stale caches for this repo before writing the fresh one
		for (const f of fs.readdirSync(cacheDir)) {
			if (f.startsWith(`gitdates-${cacheKey}-`)) fs.rmSync(path.join(cacheDir, f));
		}
		fs.writeFileSync(cacheFile, JSON.stringify(dates));
		return dates;
	};

	// submodules: one walk each, paths are repo-relative -> prefix with submodule dir
	for (const sub of submodules) {
		const name = sub.path.slice('content/'.length);
		if (!fs.existsSync(path.join(sub.fullPath, '.git'))) continue;
		const dates = loadRepo(sub.fullPath, name);
		for (const [p, epoch] of Object.entries(dates)) {
			modified[`${name}/${p}`] = epoch;
		}
	}

	// superproject: covers content/index.md, content/course-log.md, etc.
	const superDates = loadRepo(repoRoot, 'superproject');
	for (const [p, epoch] of Object.entries(superDates)) {
		if (p.startsWith('content/')) {
			const rel = p.slice('content/'.length);
			// submodule gitlinks show up as plain paths in the superproject log; skip
			// anything owned by a submodule (its own walk is authoritative)
			if (
				!submodules.some(
					(s) =>
						rel === s.path.slice('content/'.length) ||
						rel.startsWith(s.path.slice('content/'.length) + '/')
				)
			) {
				modified[rel] = epoch;
			}
		}
	}

	return { modified };
}

// YYYY-MM-DD
const iso8601DateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;

/** verbatim from the fork's lastmod.ts (minus the console warning styling) */
export function coerceDate(fp: string, d: unknown, warn?: (msg: string) => void): Date {
	// check ISO8601 date-only format
	// we treat this one as local midnight as the normal
	// js date ctor treats YYYY-MM-DD as UTC midnight
	if (typeof d === 'string' && iso8601DateOnlyRegex.test(d)) {
		d = `${d}T00:00:00`;
	}

	const dt = new Date(d as string | number);
	const invalidDate = isNaN(dt.getTime()) || dt.getTime() === 0;
	if (invalidDate && d !== undefined) {
		warn?.(`found invalid date "${d}" in \`${fp}\``);
	}

	return invalidDate ? new Date() : dt;
}

type MaybeDate = undefined | string | number;

/**
 * Same priority semantics as the fork's CreatedModifiedDate with
 * priority: ["frontmatter", "git", "filesystem"].
 */
export function resolveDates(args: {
	relativePath: string; // relative to content/
	fullPath: string;
	frontmatter: Record<string, unknown>;
	gitDates: GitDateMap;
	warn?: (msg: string) => void;
}): { created: Date; modified: Date; published: Date } {
	const { relativePath, fullPath, frontmatter, gitDates, warn } = args;
	let created: MaybeDate = undefined;
	let modified: MaybeDate = undefined;
	let published: MaybeDate = undefined;

	// frontmatter (frontmatter.ts already coalesced created/date, modified/lastmod/...)
	created ||= frontmatter.created as MaybeDate;
	modified ||= frontmatter.modified as MaybeDate;
	published ||= frontmatter.published as MaybeDate;

	// git (modified only — matches the fork)
	const gitEpoch = gitDates.modified[relativePath];
	if (gitEpoch !== undefined) {
		modified ||= gitEpoch * 1000;
	} else if (modified === undefined) {
		warn?.(`${relativePath} isn't yet tracked by git, dates will be inaccurate`);
	}

	// filesystem
	try {
		const st = fs.statSync(fullPath);
		created ||= st.birthtimeMs;
		modified ||= st.mtimeMs;
	} catch {
		/* ignore */
	}

	return {
		created: coerceDate(relativePath, created, warn),
		modified: coerceDate(relativePath, modified, warn),
		published: coerceDate(relativePath, published, warn)
	};
}
