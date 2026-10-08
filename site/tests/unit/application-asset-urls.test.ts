import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build, type Plugin } from 'vite';
import { applicationAssetUrls } from '../../tooling/lib/application-asset-urls';

const fixtures: string[] = [];
afterEach(() => {
	for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

test('actual Vite preload dependencies resolve to emitted assets from a nested client entry', async () => {
	const root = mkdtempSync(path.join(tmpdir(), 'wisconsin-asset-urls-'));
	fixtures.push(root);
	writeFileSync(path.join(root, 'entry.js'), 'export const load = () => import("./lazy.js");');
	writeFileSync(path.join(root, 'lazy.js'), 'import "./lazy.css"; export const value = 1;');
	writeFileSync(path.join(root, 'lazy.css'), '.fixture { color: red; }');
	const kitAssetUrls: Plugin = {
		name: 'fixture:kit-assets',
		config: () => ({ experimental: { renderBuiltUrl: () => ({ relative: false }) } })
	};
	await build({
		root,
		configFile: false,
		base: './',
		logLevel: 'silent',
		plugins: [kitAssetUrls, applicationAssetUrls(false)],
		build: {
			minify: false,
			rollupOptions: {
				preserveEntrySignatures: 'strict',
				input: path.join(root, 'entry.js'),
				output: {
					entryFileNames: '_app/immutable/entry/app.js',
					chunkFileNames: '_app/immutable/chunks/[name].js',
					assetFileNames: '_app/immutable/assets/[name][extname]'
				}
			}
		}
	});
	const output = path.join(root, 'dist');
	const source = readFileSync(path.join(output, '_app/immutable/entry/app.js'), 'utf8');
	const dependencies = [...source.matchAll(/["'](\/_app\/immutable\/[^"']+)["']/g)].map(
		(match) => match[1]
	);
	expect(dependencies.some((dependency) => dependency.endsWith('.css'))).toBe(true);
	expect(source).not.toContain('"./_app/');
	const emitted = readdirSync(output, { recursive: true }).map(String);
	for (const dependency of dependencies) {
		const resolved = new URL(dependency, 'https://preview.example/_app/immutable/entry/app.js');
		expect(emitted).toContain(resolved.pathname.slice(1));
	}
});

test('the wrapper delegates SSR and CSS and leaves static export configuration untouched', async () => {
	const root = mkdtempSync(path.join(tmpdir(), 'wisconsin-asset-url-hooks-'));
	fixtures.push(root);
	mkdirSync(path.join(root, 'dist'));
	const original = () => '../original';
	const plugin = applicationAssetUrls(false);
	const configure = plugin.config as (config: any, environment: any) => any;
	const configured = await configure({ experimental: { renderBuiltUrl: original } }, {});
	const render = configured.experimental.renderBuiltUrl;
	expect(render('asset.css', { ssr: false, hostType: 'js' })).toBe('/asset.css');
	expect(render('asset.png', { ssr: false, hostType: 'css' })).toBe('../original');
	expect(render('asset.png', { ssr: true, hostType: 'js' })).toBe('../original');
	const staticConfigure = applicationAssetUrls(true).config as typeof configure;
	expect(await staticConfigure({ experimental: { renderBuiltUrl: original } }, {})).toBeUndefined();
});
