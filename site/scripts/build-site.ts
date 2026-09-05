import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { publicAssetManifest } from './lib/public-assets';

const site = path.resolve(import.meta.dir, '..');
const output = path.join(site, '.svelte-kit/cloudflare');
const staged = path.join(site, '.generated/public-site');
const manifestPath = path.join(site, '.generated/public-assets.json');
let publicAssets: Record<string, string> = {};
mkdirSync(path.dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, '{}');
rmSync(staged, { recursive: true, force: true });

function build(publicEdition: boolean) {
	for (const task of ['build:content', 'build', 'build:search']) {
		const result = spawnSync('bun', ['run', task], {
			cwd: site,
			stdio: 'inherit',
			env: { ...process.env, VITE_PUBLIC_EDITION: String(publicEdition) }
		});
		if (result.status !== 0)
			throw new Error(`${publicEdition ? 'Public' : 'Full'} ${task} failed`, {
				cause: result.error
			});
	}
}

{
	build(true);
	const pages = JSON.parse(readFileSync(path.join(site, '.generated/public-routes.json'), 'utf8'));
	const content = JSON.parse(
		readFileSync(path.join(site, '.generated/content-manifest.json'), 'utf8')
	);
	for (const asset of content.htmlAssets) pages[`/${asset}`] = `${asset}.html`;
	publicAssets = publicAssetManifest(output, pages);
	cpSync(output, staged, { recursive: true });
	console.log(`publishing: ${Object.keys(pages).length} public pages; history remains private`);
}
build(false);
cpSync(staged, path.join(output, '_published'), { recursive: true });
writeFileSync(manifestPath, JSON.stringify(publicAssets));
