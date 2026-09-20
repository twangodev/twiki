import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { publicAssetManifest } from './lib/public-assets';

const site = path.resolve(import.meta.dir, '..');
const output = path.join(site, 'build/.svelte-kit/cloudflare');
const staged = path.join(site, 'build/generated/public-site');
const manifestPath = path.join(site, 'build/generated/public-assets.json');
let publicAssets: Record<string, string> = {};
mkdirSync(path.dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, '{}');
rmSync(staged, { recursive: true, force: true });

const started = performance.now();

function build(publicEdition: boolean) {
	const started = performance.now();
	const result = spawnSync('bun', ['x', 'vite', 'build'], {
		cwd: site,
		stdio: 'inherit',
		env: { ...process.env, VITE_PUBLIC_EDITION: String(publicEdition) }
	});
	if (result.status !== 0)
		throw new Error(`${publicEdition ? 'Public' : 'Full'} build failed`, {
			cause: result.error
		});
	console.log(
		`build: ${publicEdition ? 'public' : 'full'} completed in ${((performance.now() - started) / 1000).toFixed(2)}s`
	);
}

{
	build(true);
	const pages = JSON.parse(
		readFileSync(path.join(site, 'build/generated/public-routes.json'), 'utf8')
	);
	const content = JSON.parse(
		readFileSync(path.join(site, 'build/generated/content-manifest.json'), 'utf8')
	);
	for (const asset of content.htmlAssets) pages[`/${asset}`] = `${asset}.html`;
	const fileEntries = JSON.parse(
		readFileSync(path.join(site, 'src/lib/generated/file-entries.json'), 'utf8')
	);
	publicAssets = publicAssetManifest(output, pages, fileEntries);
	cpSync(output, staged, { recursive: true });
	console.log(
		`publishing: ${Object.keys(pages).length} public pages; ${fileEntries.length} file routes share one shell; history remains private`
	);
}
build(false);
cpSync(staged, path.join(output, '_published'), { recursive: true });
writeFileSync(manifestPath, JSON.stringify(publicAssets));

console.log(`build: all completed in ${((performance.now() - started) / 1000).toFixed(2)}s`);
