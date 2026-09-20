import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { CourseFile } from '../../src/lib/files';
import { writeChanged } from './output';

function stamp(file: string, output = false) {
	try {
		const stat = lstatSync(file, { bigint: true });
		return [
			String(stat.mode),
			String(stat.ino),
			String(stat.size),
			String(stat.mtimeNs),
			output ? '' : String(stat.ctimeNs),
			realpathSync(file)
		];
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	}
}

export function courseFingerprint(
	repo: string,
	course: string,
	tracked: string[],
	version: string,
	notes: string
) {
	const hash = createHash('sha256').update(JSON.stringify([repo, course, version, notes]));
	try {
		hash.update(
			execFileSync('git', ['-C', path.join(repo, 'content', course), 'rev-parse', 'HEAD'], {
				stdio: ['ignore', 'pipe', 'ignore']
			})
		);
	} catch {
		hash.update('unborn');
	}
	for (const file of [...tracked, `content/${course}/publish.yaml`])
		hash.update(JSON.stringify([file, stamp(path.join(repo, file))]));
	return hash.digest('hex');
}

type Record = {
	fingerprint: string;
	files: CourseFile[];
	outputs: [string, ReturnType<typeof stamp>][];
};
export function readCourseCache(file: string, fingerprint: string) {
	try {
		const saved: Record = JSON.parse(readFileSync(file, 'utf8'));
		if (saved.fingerprint !== fingerprint || !Array.isArray(saved.files)) return;
		if (
			!saved.outputs.every(
				([file, state]) => state && JSON.stringify(stamp(file, true)) === JSON.stringify(state)
			)
		)
			return;
		return { files: saved.files, outputs: new Set(saved.outputs.map(([file]) => file)) };
	} catch {
		return;
	}
}

export function saveCourseCache(
	file: string,
	fingerprint: string,
	files: CourseFile[],
	outputs: Set<string>
) {
	writeChanged(
		file,
		JSON.stringify({
			fingerprint,
			files,
			outputs: [...outputs].map((file) => [file, stamp(file, true)])
		})
	);
}
