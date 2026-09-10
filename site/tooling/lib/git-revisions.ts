import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Keep Git's path-limited history semantics, including merges and renames.
// A course HEAD identifies immutable answers, even when its working tree is dirty.
export function createRevisionLookup(
	head: string,
	cache: string,
	lookup: (file: string) => string
) {
	const target = path.join(cache, `revisions-v1-${head}.jsonl`);
	const revisions = new Map<string, string>();
	try {
		for (const line of readFileSync(target, 'utf8').split('\n').filter(Boolean)) {
			const entry: unknown = JSON.parse(line);
			if (
				!Array.isArray(entry) ||
				entry.length !== 2 ||
				typeof entry[0] !== 'string' ||
				typeof entry[1] !== 'string' ||
				!/^[a-f0-9]{40,64}$/.test(entry[1])
			)
				throw new Error('Invalid revision cache');
			revisions.set(entry[0], entry[1]);
		}
	} catch {
		// A partial write or damaged cache must never supply a history revision.
		revisions.clear();
		mkdirSync(cache, { recursive: true });
		writeFileSync(target, '');
	}
	return (file: string) => {
		const cached = revisions.get(file);
		if (cached) return cached;
		const revision = lookup(file);
		revisions.set(file, revision);
		appendFileSync(target, JSON.stringify([file, revision]) + '\n');
		return revision;
	};
}
