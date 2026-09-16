import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	copyFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseRmd } from '../../src/lib/rmd';
import type { CourseFile, RmdPreview } from '../../src/lib/files';
import { writeChanged } from './output';

const runner = path.join(import.meta.dirname, 'knit-rmd.R');
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const limit = 25 * 1024 * 1024;
let version: string | undefined;

function rVersion() {
	if (version) return version;
	try {
		return (version = execFileSync(
			process.env.RSCRIPT ?? 'Rscript',
			[
				'--vanilla',
				'-e',
				'cat(R.version.string); for (p in c("knitr", "evaluate", "highr", "xfun", "yaml")) cat(p, as.character(packageVersion(p)))'
			],
			{ encoding: 'utf8', timeout: 30_000 }
		));
	} catch (error) {
		throw new Error(
			'R Markdown previews require R and knitr. Install r-base-core and r-cran-knitr (see site/README.md).',
			{ cause: error }
		);
	}
}

/** Knit only available course files, in a temporary copy, never in the source checkout. */
export async function buildRmdPreviews(
	site: string,
	course: string,
	files: CourseFile[],
	output: string,
	retain: (file: string) => void
) {
	const worksheets = files.filter(
		(file) => !file.locked && file.download && /\.rmd$/i.test(file.path)
	);
	if (!worksheets.length) return;
	const available = files.filter((file) => !file.locked && file.download);
	const inputs = JSON.stringify(available.map(({ path, download }) => [path, download]).sort());
	const renderer = readFileSync(path.join(import.meta.dirname, '../../src/lib/rmd.ts'));
	const policy = digest(
		Buffer.concat([readFileSync(runner), readFileSync(import.meta.filename), renderer])
	);
	const base = `${rVersion()}\n${policy}\n${course}\n${inputs}`;
	for (const worksheet of worksheets) {
		const key = digest(`${base}\n${worksheet.path}`);
		const cache = path.join(site, 'build/generated/cache/rmd', key);
		const record = path.join(cache, 'result.json');
		let result: { preview: string; blobs: string[] } | undefined;
		if (existsSync(record)) {
			const saved = JSON.parse(readFileSync(record, 'utf8'));
			if (saved.blobs.every((blob: string) => existsSync(path.join(cache, blob)))) result = saved;
		}
		if (!result) {
			const scratch = mkdtempSync(path.join(tmpdir(), 'wisconsin-rmd-'));
			try {
				const working = path.join(scratch, 'course');
				for (const file of available) {
					const target = path.join(working, file.path);
					mkdirSync(path.dirname(target), { recursive: true });
					copyFileSync(path.join(output, 'blobs', path.basename(file.download!)), target);
				}
				const figures = path.join(scratch, 'figures');
				mkdirSync(figures);
				const knitted = path.join(scratch, 'knitted.md');
				execFileSync(
					process.env.RSCRIPT ?? 'Rscript',
					['--vanilla', runner, path.join(working, worksheet.path), knitted, figures],
					{ cwd: working, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, stdio: 'pipe' }
				);
				let markdown = readFileSync(knitted, 'utf8');
				const blobs: string[] = [];
				const save = (bytes: Uint8Array, extension: string) => {
					if (bytes.length > limit)
						throw new Error('Rendered R Markdown asset exceeds the 25 MiB hosting limit');
					const blob = `${digest(bytes)}.${extension}`;
					writeChanged(path.join(cache, blob), bytes);
					blobs.push(blob);
					return blob;
				};
				for (const figure of readdirSync(figures, { recursive: true, withFileTypes: true })) {
					if (!figure.isFile()) continue;
					const source = path.join(figure.parentPath, figure.name);
					const extension = path.extname(source).slice(1);
					if (!['png', 'jpg', 'jpeg', 'svg', 'pdf'].includes(extension))
						throw new Error(`Unsupported R plot format: ${extension}`);
					const blob = save(readFileSync(source), extension);
					markdown = markdown.split(source).join(`/_files/blobs/${blob}`);
				}
				const parsed = await parseRmd(markdown, course, worksheet.path, files);
				if (parsed.blocks.some((block) => block.kind === 'r'))
					throw new Error('Knitting left an unevaluated R chunk');
				const preview: RmdPreview = {
					title: parsed.title,
					html: parsed.blocks
						.map((block) => (block.kind === 'markdown' ? block.html : ''))
						.join('\n')
				};
				result = { preview: save(Buffer.from(JSON.stringify(preview)), 'json'), blobs };
				writeChanged(record, JSON.stringify(result));
				console.log(`rmd: rendered ${course}/${worksheet.path}`);
			} catch (error) {
				throw new Error(`Could not render ${course}/${worksheet.path}: ${String(error)}`, {
					cause: error
				});
			} finally {
				rmSync(scratch, { recursive: true, force: true });
			}
		}
		for (const blob of result.blobs) {
			const destination = path.join(output, 'blobs', blob);
			writeChanged(destination, readFileSync(path.join(cache, blob)));
			retain(destination);
		}
		worksheet.rmdPreview = `/_files/blobs/${result.preview}`;
	}
}
