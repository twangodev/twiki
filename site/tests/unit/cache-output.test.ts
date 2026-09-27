import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { publicationFixture } from '../publication-fixture';

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
			'tsconfig.json',
			'build/.svelte-kit/tsconfig.json'
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
		for (const publicEdition of [false, true]) {
			rmSync(path.join(site, 'build/generated'), { recursive: true, force: true });
			const cold = run(publicEdition);
			expect(cold).toContain('0 cached,');
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
			rmSync(path.join(site, 'build/generated'), { recursive: true });
			rmSync(path.join(site, 'static'), { recursive: true, force: true });
			cpSync(archive, cache, { recursive: true });
			expect(run(publicEdition)).toContain('0 parsed)');
			expect(outputs(path.join(site, 'build/generated/pages'))).toEqual(pages);
			expect(readManifest()).toEqual(manifest);
			expect(
				outputs(path.join(site, publicEdition ? 'build/generated/public-static' : 'static'))
			).toEqual(assets);
		}
		fixture.write('content/sp99-cs101/publish.yaml', 'include: []\n');
		expect(run(true)).toContain('0 parsed)');
		const manifest = JSON.parse(
			readFileSync(path.join(site, 'build/generated/content-manifest.json'), 'utf8')
		);
		expect(manifest.pages['sp99-cs101/notes/public'].locked).toBe(true);
	} finally {
		rmSync(fixture.repo, { recursive: true, force: true });
	}
}, 30_000);
