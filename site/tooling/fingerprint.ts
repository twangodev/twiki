import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { rolldown } from 'rolldown';

const site = path.resolve(import.meta.dirname, '..');
const socialAssets = ['assets/fonts/OverusedGrotesk-SemiBold.ttf', 'assets/social-background.svg'];
const rAssets = ['tooling/lib/knit-rmd.R'];

// Runtime reads and subprocess entrypoints are not visible in the import graph.
export const stages = {
	parser: { entries: ['tooling/compiler.ts'], assets: [] },
	history: { entries: ['tooling/lib/file-history.ts'], assets: [] },
	gitdates: { entries: ['tooling/lib/lastmod.ts'], assets: [] },
	social: { entries: ['tooling/lib/social-images.ts'], assets: socialAssets },
	rmd: { entries: ['tooling/lib/rmd-previews.ts'], assets: rAssets },
	files: {
		entries: ['tooling/lib/course-files.ts', 'tooling/lib/history-worker.ts'],
		assets: rAssets
	},
	pipeline: {
		entries: ['tooling/pipeline.ts', 'tooling/lib/history-worker.ts'],
		assets: [...socialAssets, ...rAssets]
	}
};

export type Stage = keyof typeof stages;

/** Hash portable names and bytes; never inode, mtime, or absolute checkout paths. */
function hashFiles(root: string, stage: Stage, files: string[]) {
	const hash = createHash('sha256').update(
		JSON.stringify([
			'compiler-stage-v1',
			stage,
			process.version,
			process.versions.bun ?? '',
			process.platform,
			process.arch,
			stages[stage]
		])
	);
	for (const file of files) {
		const bytes = readFileSync(path.join(root, file));
		hash.update(JSON.stringify([file, bytes.length])).update(bytes);
	}
	return hash.digest('hex');
}

export async function stageFingerprint(stage: Stage, root = site): Promise<string> {
	const definition = stages[stage];
	const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
	const packages = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
	const build = await rolldown({
		cwd: root,
		input: definition.entries.map((file) => path.join(root, file)),
		platform: 'node',
		treeshake: false,
		external: (id) =>
			isBuiltin(id) || packages.some((pkg) => id === pkg || id.startsWith(pkg + '/')),
		onwarn(warning) {
			throw new Error(`Cache dependency scan: ${warning.message}`);
		}
	});
	let sources: string[];
	try {
		// Generate in memory so Rolldown traverses imports; never execute or emit the bundle.
		await build.generate({ format: 'esm' });
		sources = (await build.watchFiles).map((file) =>
			path.relative(root, file).split(path.sep).join('/')
		);
	} finally {
		await build.close();
	}
	const files = [
		...new Set([...sources, ...definition.assets, 'bun.lock', 'package.json', 'tsconfig.json'])
	].sort();
	return hashFiles(root, stage, files);
}
