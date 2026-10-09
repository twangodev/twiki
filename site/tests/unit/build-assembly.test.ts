import { expect, test } from 'bun:test';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assembleBuilds } from '../../tooling/lib/build-assembly';
import { publicTarget } from '../../worker/publication';

function fixture() {
	const root = mkdtempSync(path.join(tmpdir(), 'wisconsin-assembly-'));
	const canonical = path.join(root, 'site');
	const publicSite = path.join(canonical, 'build/edition-runs/test/public');
	const fullSite = path.join(canonical, 'build/edition-runs/test/full');
	const write = (site: string, file: string, data: unknown) => {
		const destination = path.join(site, file);
		mkdirSync(path.dirname(destination), { recursive: true });
		writeFileSync(destination, typeof data === 'string' ? data : JSON.stringify(data));
	};
	const read = (site: string, file: string) => readFileSync(path.join(site, file), 'utf8');
	for (const site of [canonical, publicSite, fullSite]) {
		write(
			site,
			'build/.svelte-kit/cloudflare/index.html',
			site === publicSite ? 'public home' : 'private home'
		);
		write(
			site,
			'build/.svelte-kit/worker.js',
			"export { default } from '../../worker/index.ts';\n"
		);
		write(site, 'build/.svelte-kit/output/server/index.js', 'relative server import');
		write(site, 'build/.svelte-kit/cloudflare-tmp/manifest.js', 'relative worker manifest');
		write(site, 'build/generated/content-manifest.json', {
			htmlAssets: [],
			edition: site === publicSite ? 'public' : 'full'
		});
		write(
			site,
			'src/lib/generated/file-entries.json',
			site === publicSite ? [{ course: 'course', file: 'Résumé #1?.java' }] : []
		);
		write(
			site,
			'src/lib/generated/nav.json',
			site === publicSite ? 'public navigation' : 'private navigation'
		);
		write(
			site,
			'static/navigation.js',
			site === publicSite ? 'public navigation' : 'private navigation'
		);
	}
	write(canonical, 'build/generated/cache/old.json', 'old cache');
	write(canonical, 'build/.wrangler/state/secret', 'local state');
	symlinkSync('build/.wrangler', path.join(canonical, '.wrangler'));
	write(fullSite, 'build/generated/cache/current.json', 'merged current cache');
	write(fullSite, 'build/generated/cache/course-files/full/course.json', 'scratch absolute stamps');
	write(fullSite, 'build/generated/dev-state.json', 'scratch dev stamp');
	write(fullSite, 'build/.svelte-kit/cloudflare/_files/history/private.json', 'private history');
	write(fullSite, 'build/.svelte-kit/cloudflare/_files/blobs/private.bin', 'private body');
	write(fullSite, 'build/.svelte-kit/cloudflare/graph.json', 'private graph');
	write(publicSite, 'build/generated/public-routes.json', {
		'/': 'index.html',
		'/Résumé': 'Résumé.html'
	});
	write(publicSite, 'build/.svelte-kit/cloudflare/Résumé.html', 'public note');
	write(publicSite, 'build/.svelte-kit/cloudflare/_file-browser.html', 'public shell');
	write(publicSite, 'build/.svelte-kit/cloudflare/graph.json', 'public graph');
	write(publicSite, 'build/.svelte-kit/cloudflare/navigation.js', 'public navigation');
	for (const name of ['public-assets', 'public-files', 'public-static'])
		write(publicSite, `build/generated/${name}/retained`, name);
	return { root, canonical, publicSite, fullSite, write, read };
}

test('assembly uses only public snapshot aliases and promotes complete full output without local state', () => {
	const f = fixture();
	try {
		const result = assembleBuilds(f.canonical, f.publicSite, f.fullSite);
		expect(result.publicPages).toBe(2);
		expect(result.fileRoutes).toBe(1);
		expect(result.publicAssets['/R%C3%A9sum%C3%A9']).toBe('/_published/R%C3%A9sum%C3%A9');
		expect(result.publicAssets['/course/files/R%C3%A9sum%C3%A9%20%231%3F.java']).toBe(
			'/_published/_file-browser'
		);
		for (const url of [
			'/_files/history/private.json',
			'/_files/blobs/private.bin',
			'/_published/graph.json'
		])
			expect(
				publicTarget(new Request(`https://example.com${url}`), result.publicAssets)
			).toBeUndefined();
		expect(f.read(f.canonical, 'build/.svelte-kit/cloudflare/_published/graph.json')).toBe(
			'public graph'
		);
		expect(f.read(f.canonical, 'build/.svelte-kit/cloudflare/graph.json')).toBe('private graph');
		expect(f.read(f.canonical, 'src/lib/generated/nav.json')).toBe('private navigation');
		expect(JSON.parse(f.read(f.canonical, 'src/lib/generated/file-entries.json'))).toEqual([]);
		expect(f.read(f.canonical, 'build/generated/public-assets.json')).toBe(
			JSON.stringify(result.publicAssets)
		);
		expect(f.read(f.canonical, 'build/.svelte-kit/worker.js')).toBe(
			"export { default } from '../../worker/index.ts';\n"
		);
		expect(f.read(f.canonical, 'build/.svelte-kit/cloudflare-tmp/manifest.js')).toBe(
			'relative worker manifest'
		);
		expect(f.read(f.canonical, 'build/.svelte-kit/output/server/index.js')).toBe(
			'relative server import'
		);
		expect(f.read(f.canonical, 'build/generated/cache/current.json')).toBe('merged current cache');
		expect(existsSync(path.join(f.canonical, 'build/generated/cache/course-files'))).toBe(false);
		expect(existsSync(path.join(f.canonical, 'build/generated/dev-state.json'))).toBe(false);
		for (const name of ['public-assets', 'public-files', 'public-static'])
			expect(f.read(f.canonical, `build/generated/${name}/retained`)).toBe(name);
		expect(f.read(f.canonical, '.wrangler/state/secret')).toBe('local state');
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test('missing public targets fail before changing previous canonical output', () => {
	const f = fixture();
	try {
		f.write(f.publicSite, 'build/generated/public-routes.json', { '/missing': 'missing.html' });
		expect(() => assembleBuilds(f.canonical, f.publicSite, f.fullSite)).toThrow();
		expect(f.read(f.canonical, 'build/.svelte-kit/cloudflare/index.html')).toBe('private home');
		expect(f.read(f.canonical, 'build/generated/cache/old.json')).toBe('old cache');
		expect(f.read(f.canonical, '.wrangler/state/secret')).toBe('local state');
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test('a promotion filesystem failure rolls back already installed output and generated metadata', () => {
	const f = fixture();
	try {
		rmSync(path.join(f.canonical, 'src/lib'), { recursive: true });
		f.write(f.canonical, 'src/lib', 'existing source blocks directory creation');
		expect(() => assembleBuilds(f.canonical, f.publicSite, f.fullSite)).toThrow();
		expect(f.read(f.canonical, 'build/.svelte-kit/cloudflare/index.html')).toBe('private home');
		expect(f.read(f.canonical, 'build/generated/cache/old.json')).toBe('old cache');
		expect(f.read(f.canonical, 'static/navigation.js')).toBe('private navigation');
		expect(f.read(f.canonical, 'src/lib')).toBe('existing source blocks directory creation');
		expect(f.read(f.canonical, '.wrangler/state/secret')).toBe('local state');
		expect(f.read(f.fullSite, 'build/.svelte-kit/cloudflare/graph.json')).toBe('private graph');
		expect(f.read(f.publicSite, 'build/.svelte-kit/cloudflare/graph.json')).toBe('public graph');
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test('public output symlinks cannot widen publication to another snapshot', () => {
	const f = fixture();
	try {
		symlinkSync(
			path.join(f.fullSite, 'build/.svelte-kit/cloudflare/_files'),
			path.join(f.publicSite, 'build/.svelte-kit/cloudflare/private-link')
		);
		expect(() => assembleBuilds(f.canonical, f.publicSite, f.fullSite)).toThrow('symlink');
		expect(f.read(f.canonical, 'build/generated/cache/old.json')).toBe('old cache');
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});
