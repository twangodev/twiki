import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { parseGitmodules } from './lastmod';

function stamp(file: string) {
	try {
		const stat = lstatSync(file, { bigint: true });
		return [
			String(stat.mode),
			String(stat.ino),
			String(stat.size),
			String(stat.mtimeNs),
			String(stat.ctimeNs),
			stat.isSymbolicLink() ? readlinkSync(file) : ''
		];
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	}
}

/** Validate tracked paths, working-copy edits, index changes and Git dates without reading large assets. */
export function contentInputFingerprint(repo: string, pipeline: string) {
	const hash = createHash('sha256').update(pipeline).update(repo);
	const modules = path.join(repo, '.gitmodules');
	hash.update(existsSync(modules) ? readFileSync(modules) : '');
	const repositories = [
		repo,
		...parseGitmodules(modules)
			.filter((course) => course.path.startsWith('content/'))
			.map((course) => course.fullPath)
	];
	for (const directory of repositories) {
		const git = (...args: string[]) =>
			execFileSync('git', ['-C', directory, ...args], { maxBuffer: 128 * 1024 * 1024 });
		hash.update(directory).update(git('rev-parse', 'HEAD'));
		const tracked = git(
			'ls-files',
			'-z',
			'--stage',
			...(directory === repo ? ['--', 'content'] : [])
		);
		hash.update(tracked);
		for (const entry of tracked.toString().split('\0').filter(Boolean)) {
			const file = entry.slice(entry.indexOf('\t') + 1);
			hash.update(JSON.stringify([file, stamp(path.join(directory, file))]));
		}
	}
	return hash.digest('hex');
}

/** A production build or missing/modified output invalidates the saved dev result. */
export function contentOutputFingerprint(site: string) {
	const hash = createHash('sha256');
	function walk(file: string) {
		const state = stamp(file);
		if (state && lstatSync(file).isDirectory()) {
			for (const name of readdirSync(file).sort()) walk(path.join(file, name));
		} else hash.update(JSON.stringify([path.relative(site, file), state]));
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
