import path from 'node:path';
import { appendFileSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { captureRRenderProfile } from './lib/r-runtime';

const command = process.argv[2];
const site = path.resolve(import.meta.dirname, '..');
const options = process.argv.slice(3);
const ownedOutput = (file: string) => {
	const absolute = path.resolve(file);
	mkdirSync(path.dirname(absolute), { recursive: true });
	const info = lstatSync(absolute, { throwIfNoEntry: false });
	if (
		realpathSync(path.dirname(absolute)) !== path.dirname(absolute) ||
		(info && (!info.isFile() || realpathSync(absolute) !== absolute))
	)
		throw new Error('R cache output must be an owned regular file');
	return absolute;
};
if (
	command === 'capture-profile' &&
	(!options.length || (options.length === 2 && options[0] === '--output'))
) {
	const bytes = JSON.stringify(captureRRenderProfile(), null, 2) + '\n';
	if (options.length) writeFileSync(ownedOutput(options[1]), bytes);
	console.log(bytes.trimEnd());
} else if (
	command === 'preflight' &&
	(!options.length || (options.length === 1 && options[0] === '--github-output'))
) {
	const { preflightRmdPreviews } = await import('./lib/rmd-preflight');
	const result = await preflightRmdPreviews(
		site,
		process.env.WISCONSIN_CONTENT_REPO ?? path.dirname(site)
	);
	if (options.length) {
		if (!process.env.GITHUB_OUTPUT)
			throw new Error('GITHUB_OUTPUT is required with --github-output');
		appendFileSync(
			ownedOutput(process.env.GITHUB_OUTPUT),
			`requiresR=${result.requiresR}\nworksheets=${result.worksheets}\nverified=${result.verified}\n`
		);
	}
	console.log(JSON.stringify(result));
} else
	throw new Error(
		'Use bun tooling/r-cache.ts capture-profile [--output <file>] or preflight [--github-output]'
	);
