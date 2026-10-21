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
type SourceReader = (source: string) => Uint8Array | undefined;
const copiedOutputs = new Map<
	string,
	{ source: string; input: string; output: string; read: SourceReader }
>();

function fileStamp(file: string) {
	const stat = statSync(file, { bigint: true, throwIfNoEntry: false });
	return stat?.isFile()
		? [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
		: undefined;
}

/** A shared collector retains invalidations across failed or repeated passes. */
export async function trackOutputs(build: () => Promise<unknown>, files = new Set<string>()) {
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

/** In a running dev server, reuse only copies whose source and output metadata still match. */
export function copyChanged(
	source: string,
	destination: string,
	development = false,
	read: SourceReader = readFileSync
) {
	const input = development ? fileStamp(source) : undefined;
	const previous = copiedOutputs.get(destination);
	if (
		input &&
		previous?.source === source &&
		previous.read === read &&
		previous.input === input &&
		previous.output === fileStamp(destination)
	)
		return true;
	const bytes = read(source);
	if (!bytes) {
		copiedOutputs.delete(destination);
		return false;
	}
	writeChanged(destination, bytes);
	if (development && input) {
		const output = fileStamp(destination);
		if (output) copiedOutputs.set(destination, { source, input, output, read });
	} else copiedOutputs.delete(destination);
	return true;
}

/** Paths are absolute. Each caller prunes only the directory it owns. */
export function pruneOutputs(
	directory: string,
	wanted: Set<string>,
	keep?: (file: string) => boolean
) {
	let removed = 0;
	function prune(directory: string): boolean {
		let empty = true;
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const file = path.join(directory, entry.name);
			if (keep?.(file)) {
				empty = false;
			} else if (entry.isDirectory()) {
				if (prune(file)) rmSync(file, { recursive: true });
				else empty = false;
			} else if (wanted.has(file)) {
				empty = false;
			} else {
				rmSync(file);
				copiedOutputs.delete(file);
				changes.getStore()?.add(path.resolve(file));
				removed++;
			}
		}
		return empty;
	}
	if (existsSync(directory)) prune(directory);
	return removed;
}
