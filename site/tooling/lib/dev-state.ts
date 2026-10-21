import { createHash } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	realpathSync,
	type BigIntStats
} from 'node:fs';
import path from 'node:path';
import { contentGit, contentRepositories } from './dev-git-state';
import {
	resolveProject,
	discoverSourceEntries,
	projectIdentity,
	gitAvailable,
	contentWithinProject,
	withSourceDiscovery,
	type ResolvedProject,
	type SourceEntry,
	type SourceRepository
} from './project-config';

function fileStat(file: string): BigIntStats | null {
	try {
		return lstatSync(file, { bigint: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	}
}

function stamp(file: string, stat: Readonly<BigIntStats> | null = fileStat(file)) {
	if (!stat) return null;
	return [
		String(stat.mode),
		String(stat.ino),
		String(stat.size),
		String(stat.mtimeNs),
		String(stat.ctimeNs),
		stat.isSymbolicLink() ? readlinkSync(file) : ''
	];
}

type ObservationKind = 'stat' | 'bytes';
const observationKey = (kind: ObservationKind, file: string) => `${kind}\0${file}`;
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const contextKey = (project: ResolvedProject, pipeline: string) =>
	JSON.stringify([pipeline, projectIdentity(project), project.configFile ?? null]);

/** A candidate input snapshot is accepted only after a fresh post-build capture agrees. */
export class ContentInputSnapshot {
	readonly fingerprint: string;
	private readonly sources: Map<string, SourceEntry>;
	constructor(
		private readonly project: ResolvedProject,
		private readonly pipeline: string,
		private readonly entries: readonly SourceEntry[],
		private readonly shape: string,
		private readonly observations: ReadonlyMap<string, string | null>,
		private readonly repositories: readonly SourceRepository[]
	) {
		this.sources = new Map(
			entries.map((entry) => [path.join(project.contentDir, entry.relative), entry])
		);
		const hash = createHash('sha256').update(contextKey(project, pipeline)).update(shape);
		for (const key of [...observations.keys()].sort())
			hash.update(JSON.stringify([key, observations.get(key)]));
		this.fingerprint = hash.digest('hex');
	}

	/** Existing regular files only. Structural, Git, and configuration events need a full capture. */
	refresh(project: ResolvedProject, pipeline: string, changed: ReadonlySet<string> | undefined) {
		if (
			!changed?.size ||
			[...changed].some((file) => !this.sources.has(file)) ||
			contextKey(project, pipeline) !== contextKey(this.project, this.pipeline)
		)
			return;
		const replacements = new Map<string, SourceEntry>();
		const observations = new Map(this.observations);
		for (const file of changed) {
			const previous = this.sources.get(file);
			if (!previous) return;
			let stat: BigIntStats | null;
			try {
				stat = fileStat(file);
				if (!stat?.isFile() || realpathSync(file) !== file) return;
			} catch (error) {
				if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
				throw error;
			}
			replacements.set(previous.relative, { relative: previous.relative, stat });
			for (const kind of ['stat', 'bytes'] as const) {
				const key = observationKey(kind, file);
				if (observations.has(key))
					observations.set(
						key,
						kind === 'stat' ? JSON.stringify(stamp(file, stat)) : digest(readFileSync(file))
					);
			}
			// Atomic saves also change containing gitlink directories recorded by Git.
			for (let directory = path.dirname(file); ; ) {
				const key = observationKey('stat', directory);
				if (observations.has(key)) observations.set(key, JSON.stringify(stamp(directory)));
				const parent = path.dirname(directory);
				if (parent === directory) break;
				directory = parent;
			}
		}
		return new ContentInputSnapshot(
			project,
			pipeline,
			this.entries.map((entry) => replacements.get(entry.relative) ?? entry),
			this.shape,
			observations,
			this.repositories
		);
	}

	withDiscovery<T>(build: () => T): T {
		return withSourceDiscovery(build, {
			project: this.project,
			entries: this.entries,
			repositories: this.repositories
		});
	}
}

/** Read the complete source catalog and Git state, independent of watcher hints. */
export function captureContentInputs(repo: string, pipeline: string) {
	const project = resolveProject(process.cwd(), repo);
	const entries = discoverSourceEntries(project);
	const observations = new Map<string, string | null>();
	const observeStat = (file: string, info?: Readonly<BigIntStats>) => {
		const key = observationKey('stat', file);
		if (!observations.has(key)) observations.set(key, JSON.stringify(stamp(file, info)));
	};
	const observeBytes = (file: string, optional = false) => {
		const key = observationKey('bytes', file);
		if (!observations.has(key))
			observations.set(key, optional && !existsSync(file) ? null : digest(readFileSync(file)));
	};
	for (const entry of entries) {
		const file = path.join(project.contentDir, entry.relative);
		if (project.discovery === 'filesystem') observeBytes(file);
		else observeStat(file, entry.stat);
	}
	if (project.configFile) observeBytes(project.configFile);
	observeBytes(path.join(repo, '.gitmodules'), true);
	const metadata = contentRepositories(repo);
	const repositories = metadata.map((repository) => {
		const { directory, head, tracked, config, worktreeConfig } = repository;
		observeStat(config);
		observeStat(worktreeConfig);
		observeBytes(path.join(directory, '.gitmodules'), true);
		for (const entry of tracked.toString().split('\0').filter(Boolean))
			observeStat(path.join(directory, entry.slice(entry.indexOf('\t') + 1)));
		return [directory, head, digest(tracked), config, worktreeConfig];
	});
	const recursive =
		project.discovery === 'git' && contentWithinProject(project) && gitAvailable(repo)
			? digest(
					contentGit(
						'-C',
						repo,
						'ls-files',
						'-z',
						'--stage',
						'--recurse-submodules',
						'--',
						path.relative(repo, project.contentDir) || '.'
					)
				)
			: null;
	const shape = digest(
		JSON.stringify([
			'content-input-snapshot-v2',
			entries.map((entry) => entry.relative),
			repositories,
			recursive
		])
	);
	return new ContentInputSnapshot(project, pipeline, entries, shape, observations, metadata);
}

/** Public full-validation entry point; never use watcher hints for saved-output reuse. */
export function contentInputFingerprint(repo: string, pipeline: string) {
	return captureContentInputs(repo, pipeline).fingerprint;
}

/** A production build or missing/modified output invalidates the saved dev result. */
export function contentOutputFingerprint(site: string) {
	return fingerprintContentOutputs(site);
}

export interface ContentOutputSnapshot {
	readonly fingerprint: string;
	readonly files: ReadonlyMap<string, Readonly<BigIntStats>>;
}

/** Retain the exact identities checked during startup, never newer observations. */
export function captureContentOutputs(site: string): ContentOutputSnapshot {
	const files = new Map<string, Readonly<BigIntStats>>();
	const fingerprint = fingerprintContentOutputs(site, (file, stat) => {
		if (stat?.isFile()) files.set(path.resolve(file), stat);
	});
	return { fingerprint, files };
}

function fingerprintContentOutputs(
	site: string,
	observe?: (file: string, stat: Readonly<BigIntStats> | null) => void
) {
	const hash = createHash('sha256');
	function walk(file: string) {
		const stat = fileStat(file);
		if (stat?.isDirectory()) {
			for (const name of readdirSync(file).sort()) walk(path.join(file, name));
		} else {
			observe?.(file, stat);
			hash.update(JSON.stringify([path.relative(site, file), stamp(file, stat)]));
		}
	}
	for (const file of [
		'build/generated/content-manifest.json',
		'build/generated/expected-404.json',
		'build/generated/expected-missing-id.json',
		'build/generated/pages',
		'build/generated/assets',
		...(process.env.VITE_PUBLIC_EDITION === 'true'
			? [
					'build/generated/public-assets',
					'build/generated/public-files',
					'build/generated/public-static'
				]
			: []),
		'src/lib/generated',
		'static'
	])
		walk(path.join(site, file));
	return hash.digest('hex');
}
