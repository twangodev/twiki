import { createHash } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	type BigIntStats
} from 'node:fs';
import path from 'node:path';
import { contentGit, contentRepositories } from './dev-git-state';

function fileStat(file: string): BigIntStats | null {
	try {
		return lstatSync(file, { bigint: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	}
}

function stamp(file: string, stat = fileStat(file)) {
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

/** Validate tracked paths, working-copy edits, index changes and Git dates without reading large assets. */
export function contentInputFingerprint(repo: string, pipeline: string) {
	const hash = createHash('sha256').update(pipeline).update(repo);
	const modules = path.join(repo, '.gitmodules');
	hash.update(existsSync(modules) ? readFileSync(modules) : '');
	for (const repository of contentRepositories(repo)) {
		const { directory, head, tracked, config, worktreeConfig } = repository;
		hash.update(directory).update(head).update(tracked);
		// Registration and worktree-specific config can change recursive visibility
		// without changing a commit or any tracked working-copy file.
		hash.update(JSON.stringify([stamp(config), stamp(worktreeConfig)]));
		const modules = path.join(directory, '.gitmodules');
		hash.update(existsSync(modules) ? readFileSync(modules) : '');
		for (const entry of tracked.toString().split('\0').filter(Boolean)) {
			const file = entry.slice(entry.indexOf('\t') + 1);
			hash.update(JSON.stringify([file, stamp(path.join(directory, file))]));
		}
	}
	// Git's recursive index is authoritative about which initialized submodules
	// are enabled, including nested registration changes.
	hash.update(
		contentGit('-C', repo, 'ls-files', '-z', '--stage', '--recurse-submodules', '--', 'content')
	);
	return hash.digest('hex');
}

/** A production build or missing/modified output invalidates the saved dev result. */
export function contentOutputFingerprint(site: string) {
	const hash = createHash('sha256');
	function walk(file: string) {
		const stat = fileStat(file);
		if (stat?.isDirectory()) {
			for (const name of readdirSync(file).sort()) walk(path.join(file, name));
		} else hash.update(JSON.stringify([path.relative(site, file), stamp(file, stat)]));
	}
	for (const file of [
		'build/generated/content-manifest.json',
		'build/generated/expected-404.json',
		'build/generated/expected-missing-id.json',
		'build/generated/public-routes.json',
		'build/generated/public-assets.json',
		'build/generated/pages',
		'build/generated/assets',
		'src/lib/generated',
		'static'
	])
		walk(path.join(site, file));
	return hash.digest('hex');
}
