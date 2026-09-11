import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function parserFingerprint() {
	return sourceFingerprint([
		'compiler.ts',
		'lib/slug.ts',
		'lib/ofm.ts',
		'lib/comments.ts',
		'lib/currency.ts',
		'lib/autotag.ts',
		'lib/lastmod.ts',
		'lib/publishing.ts',
		'lib/public-links.ts',
		'../bun.lock',
		'../src/lib/config.ts',
		'../src/lib/metadata.ts',
		'../src/lib/social-image.ts',
		'../src/lib/types.ts'
	]);
}

function sourceFingerprint(files: string[]) {
	const hash = createHash('sha256');
	for (const file of files) hash.update(readFileSync(path.resolve(import.meta.dirname, file)));
	return hash.digest('hex');
}

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
		'../src/lib/social-image.ts',
		'../src/lib/types.ts',
		'../assets/fonts/OverusedGrotesk-SemiBold.ttf',
		'../assets/social-background.svg'
	])
		hash.update(readFileSync(path.resolve(directory, file)));
	return hash.digest('hex');
}
