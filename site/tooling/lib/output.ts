import { AsyncLocalStorage } from 'node:async_hooks';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
	type BigIntStats
} from 'node:fs';
import path from 'node:path';
import type { OutputCheckpoint } from './output-checkpoint';

const changes = new AsyncLocalStorage<Set<string>>();
const checkpoints = new AsyncLocalStorage<OutputCheckpoint | undefined>();

/** Record only known writes or byte-validated output observations in the active pass. */
export function recordOutput(file: string, info?: Readonly<BigIntStats>) {
	const checkpoint = checkpoints.getStore();
	if (!checkpoint) return;
	if (info) {
		checkpoint.record(file, info);
		return;
	}
	if (!checkpoint.handles(file)) return;
	const observed = lstatSync(file, { bigint: true, throwIfNoEntry: false });
	if (!observed) throw new Error(`Generated output disappeared before observation: ${file}`);
	checkpoint.record(file, observed);
}

/** Record a known deletion, including its effect on surviving hardlink aliases. */
export function removeOutput(file: string) {
	checkpoints.getStore()?.remove(file);
}
type SourceReader = (source: string) => Uint8Array | undefined;
const copiedOutputs = new Map<
	string,
	{ source: string; input: string; output: string; read: SourceReader }
>();

export interface CopyValidation {
	source: string;
	destination: string;
	input: string;
	output: string;
}

/** Capture original byte-validation observations, restricted to one reader contract. */
export function* captureCopyValidation(read: SourceReader): Generator<CopyValidation> {
	for (const [destination, copy] of copiedOutputs)
		if (copy.read === read) {
			const { source, input, output } = copy;
			yield { source, destination, input, output };
		}
}

/** Restore only when the independently validated output still matches the copy observation. */
export function restoreCopyValidation(
	copy: CopyValidation,
	observed: Readonly<BigIntStats>,
	read: SourceReader
) {
	if (copy.output === copyStamp(observed)) {
		const { destination, ...identity } = copy;
		copiedOutputs.set(destination, { ...identity, read });
	}
}

function copyStamp(stat: Readonly<BigIntStats> | undefined) {
	return stat?.isFile()
		? [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
		: undefined;
}

function fileStamp(file: string) {
	return copyStamp(statSync(file, { bigint: true, throwIfNoEntry: false }));
}

/** Restore only copies proven by validated source AND output snapshots, using their original observations. */
export function restoreCopy(
	source: string,
	destination: string,
	sourceStat: Readonly<BigIntStats>,
	outputStat: Readonly<BigIntStats>,
	read: SourceReader = readFileSync
) {
	const input = copyStamp(sourceStat);
	const output = copyStamp(outputStat);
	if (input && output) copiedOutputs.set(destination, { source, input, output, read });
}

/** A shared collector retains invalidations across failed or repeated passes. */
export async function trackOutputs(
	build: () => Promise<unknown>,
	files = new Set<string>(),
	checkpoint?: OutputCheckpoint
) {
	await changes.run(files, () => checkpoints.run(checkpoint, build));
	return files;
}

/** Replace changed files atomically; preserve unchanged mtimes and hardlinked assets. */
export function writeChanged(file: string, data: string | Uint8Array) {
	const bytes = Buffer.from(data);
	const existing = lstatSync(file, { bigint: true, throwIfNoEntry: false });
	if (
		existing?.isFile() &&
		existing.size === BigInt(bytes.length) &&
		readFileSync(file).equals(bytes)
	) {
		recordOutput(file, existing);
		return;
	}
	mkdirSync(path.dirname(file), { recursive: true });
	const temporary = `${file}.tmp-${process.pid}`;
	try {
		writeFileSync(temporary, bytes);
		renameSync(temporary, file);
	} finally {
		rmSync(temporary, { force: true });
	}
	changes.getStore()?.add(path.resolve(file));
	recordOutput(file);
}

/** Return validated output size; dev reuse requires matching source and output identities. */
export function copyChanged(
	source: string,
	destination: string | readonly string[],
	development = false,
	read: SourceReader = readFileSync
): number | undefined {
	const input = development ? fileStamp(source) : undefined;
	const destinations = typeof destination === 'string' ? [destination] : destination;
	const pending: string[] = [];
	let size: number | undefined;
	for (const file of destinations) {
		const previous = copiedOutputs.get(file);
		if (
			input &&
			previous?.source === source &&
			previous.read === read &&
			previous.input === input
		) {
			const output = statSync(file, { bigint: true, throwIfNoEntry: false });
			if (output && previous.output === copyStamp(output)) {
				recordOutput(file, output);
				size = Number(output.size);
				continue;
			}
		}
		pending.push(file);
	}
	if (!pending.length) return size;
	const bytes = read(source);
	if (!bytes) {
		for (const file of destinations) copiedOutputs.delete(file);
		return;
	}
	for (const file of pending) {
		writeChanged(file, bytes);
		if (development && input) {
			const output = fileStamp(file);
			if (output) copiedOutputs.set(file, { source, input, output, read });
		} else copiedOutputs.delete(file);
	}
	return bytes.byteLength;
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
				removeOutput(file);
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
