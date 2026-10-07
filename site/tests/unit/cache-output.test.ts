import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import path from 'node:path';
import { publicationFixture } from '../publication-fixture';
import { compilerCacheFiles, historyCachePath } from '../../tooling/lib/cache-selection';

function outputs(directory: string) {
	return Object.fromEntries(
		readdirSync(directory, { recursive: true, withFileTypes: true })
			.filter((file) => file.isFile())
			.map((file) => {
				const absolute = path.join(file.parentPath, file.name);
				return [
					path.relative(directory, absolute),
					createHash('sha256').update(readFileSync(absolute)).digest('hex')
				];
			})
	);
}

test('restored stage caches reproduce cold public and full output and honor publication changes', () => {
	const fixture = publicationFixture();
	const source = path.resolve(import.meta.dirname, '../..');
	const site = path.join(fixture.repo, 'site');
	mkdirSync(site);
	try {
		for (const file of [
			'tooling',
			'src/lib',
			'assets',
			'package.json',
			'bun.lock',
			'tsconfig.json'
		]) {
			const target = path.join(site, file);
			mkdirSync(path.dirname(target), { recursive: true });
			cpSync(path.join(source, file), target, {
				recursive: true,
				filter: (file) => !file.includes('/src/lib/generated')
			});
		}
		symlinkSync(path.join(source, 'node_modules'), path.join(site, 'node_modules'), 'dir');
		const run = (publicEdition: boolean) =>
			execFileSync('bun', ['tooling/prepare.ts'], {
				cwd: site,
				env: {
					...process.env,
					WISCONSIN_CONTENT_REPO: fixture.repo,
					VITE_PUBLIC_EDITION: String(publicEdition)
				},
				encoding: 'utf8',
				maxBuffer: 4 * 1024 * 1024
			});
		const readManifest = () => {
			// Fresh output directories get a new build timestamp even when content is identical.
			const { generatedAt, ...manifest } = JSON.parse(
				readFileSync(path.join(site, 'build/generated/content-manifest.json'), 'utf8')
			);
			return manifest;
		};
		const cache = path.join(site, 'build/generated/cache');
		const archive = path.join(fixture.repo, 'saved-cache');
		for (const publicEdition of [true, false]) {
			rmSync(path.join(site, 'build/generated'), { recursive: true, force: true });
			const cold = run(publicEdition);
			expect(cold).toContain('0 cached,');
			const currentParser = () =>
				JSON.parse(readFileSync(path.join(cache, 'stage1-current.json'), 'utf8')) as string[];
			const currentKeys = Object.keys(outputs(path.join(cache, 'stage1')))
				.map((file) => `stage1/${file}`)
				.sort();
			expect(currentParser()).toEqual(currentKeys);
			if (!publicEdition) {
				const history = JSON.parse(
					readFileSync(path.join(cache, 'history-current.json'), 'utf8')
				) as string[];
				const expected = Object.keys(outputs(path.join(cache, 'file-history')))
					.map((file) => `file-history/${file}`)
					.filter((file) => historyCachePath.test(file))
					.sort();
				expect(history.length).toBeGreaterThan(0);
				expect(history).toEqual(expected);
			}
			const staleParser = `stage1/ff/${'f'.repeat(64)}.json`;
			mkdirSync(path.dirname(path.join(cache, staleParser)), { recursive: true });
			writeFileSync(path.join(cache, staleParser), 'stale parse generation');
			const pages = outputs(path.join(site, 'build/generated/pages'));
			const manifest = readManifest();
			const assets = outputs(
				path.join(site, publicEdition ? 'build/generated/public-static' : 'static')
			);
			rmSync(archive, { recursive: true, force: true });
			mkdirSync(archive);
			for (const directory of ['stage1', 'file-history', 'social-titles', 'rmd']) {
				try {
					cpSync(path.join(cache, directory), path.join(archive, directory), { recursive: true });
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
				}
			}
			if (!publicEdition)
				cpSync(
					path.join(cache, 'history-current.json'),
					path.join(archive, 'history-current.json')
				);
			rmSync(path.join(site, 'build/generated'), { recursive: true });
			rmSync(path.join(site, 'static'), { recursive: true, force: true });
			cpSync(archive, cache, { recursive: true });
			if (!publicEdition)
				expect(
					compilerCacheFiles(cache).filter((file) => historyCachePath.test(file)).length
				).toBeGreaterThan(0);
			expect(run(publicEdition)).toContain('0 parsed)');
			expect(currentParser()).toEqual(currentKeys);
			expect(readFileSync(path.join(cache, staleParser), 'utf8')).toBe('stale parse generation');
			const socialKeys = JSON.parse(
				readFileSync(
					path.join(cache, `social-titles-current-${publicEdition ? 'public' : 'full'}.json`),
					'utf8'
				)
			) as string[];
			expect(socialKeys.length).toBeGreaterThan(0);
			for (const file of socialKeys)
				expect(readFileSync(path.join(cache, file)).length).toBeGreaterThan(0);
			expect(outputs(path.join(site, 'build/generated/pages'))).toEqual(pages);
			expect(readManifest()).toEqual(manifest);
			expect(
				outputs(path.join(site, publicEdition ? 'build/generated/public-static' : 'static'))
			).toEqual(assets);
		}
		const privateAsset = path.join(site, 'build/generated/assets/sp99-cs101/exams/restricted.pdf');
		const assetBefore = statSync(privateAsset);
		fixture.write('content/sp99-cs101/publish.yaml', 'include: []\n');
		expect(run(true)).toContain('0 parsed)');
		expect(statSync(privateAsset).ino).toBe(assetBefore.ino);
		expect(statSync(privateAsset).mtimeMs).toBe(assetBefore.mtimeMs);
		expect(
			existsSync(path.join(site, 'build/generated/public-assets/sp99-cs101/exams/restricted.pdf'))
		).toBe(false);
		const manifest = JSON.parse(
			readFileSync(path.join(site, 'build/generated/content-manifest.json'), 'utf8')
		);
		expect(manifest.pages['sp99-cs101/notes/public'].locked).toBe(true);
		expect(run(false)).toContain('0 parsed)');
		expect(statSync(privateAsset).ino).toBe(assetBefore.ino);
		expect(statSync(privateAsset).mtimeMs).toBe(assetBefore.mtimeMs);
	} finally {
		rmSync(fixture.repo, { recursive: true, force: true });
	}
}, 30_000);
