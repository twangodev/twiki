import { AsyncLocalStorage } from 'node:async_hooks';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import path from 'node:path';

const changes = new AsyncLocalStorage<Set<string>>();

export async function trackOutputs(build: () => Promise<void>) {
	const files = new Set<string>();
	await changes.run(files, build);
	return files;
}

/** Replace changed files atomically; preserve unchanged mtimes and hardlinked assets. */
export function writeChanged(file: string, data: string | Uint8Array) {
	const bytes = Buffer.from(data);
	if (existsSync(file) && statSync(file).size === bytes.length && readFileSync(file).equals(bytes))
		return;
	mkdirSync(path.dirname(file), { recursive: true });
	const temporary = `${file}.tmp-${process.pid}`;
	try {
		writeFileSync(temporary, bytes);
		renameSync(temporary, file);
	} finally {
		rmSync(temporary, { force: true });
	}
	changes.getStore()?.add(path.resolve(file));
}

export function copyChanged(source: string, destination: string) {
	writeChanged(destination, readFileSync(source));
}

/** Paths are absolute. Each caller prunes only the directory it owns. */
export function pruneOutputs(
	directory: string,
	wanted: Set<string>,
	keep?: (file: string) => boolean
) {
	if (!existsSync(directory)) return;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const file = path.join(directory, entry.name);
		if (keep?.(file)) continue;
		if (entry.isDirectory()) {
			pruneOutputs(file, wanted, keep);
			if (!readdirSync(file).length) rmSync(file, { recursive: true });
		} else if (!wanted.has(file)) {
			rmSync(file);
			changes.getStore()?.add(path.resolve(file));
		}
	}
}
