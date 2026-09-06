import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function pipelineFingerprint() {
	const directory = import.meta.dirname;
	const sources = readdirSync(directory, { recursive: true })
		.filter((file) => /\.[jt]s$/.test(String(file)))
		.map((file) => path.join(directory, String(file)));
	const hash = createHash('sha256');
	for (const file of [
		...sources.sort(),
		'../bun.lock',
		'../src/lib/config.ts',
		'../src/lib/metadata.ts',
		'../src/lib/types.ts'
	])
		hash.update(readFileSync(path.resolve(directory, file)));
	return hash.digest('hex');
}
