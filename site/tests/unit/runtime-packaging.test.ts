import { afterEach, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	captureRuntimeEdition,
	packageRuntime,
	promoteRuntimeProduct
} from '../../tooling/lib/runtime-packaging';
import { createAssetInventory, deploymentAsset } from '../../tooling/lib/deployment-manifest';
import { sha256 } from '../../tooling/lib/deployment-config';

const roots: string[] = [];
const appVersion = 'a'.repeat(64);
function write(root: string, name: string, value: string | object) {
	const file = path.join(root, name);
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
}
function fixture() {
	const site = mkdtempSync(path.join(tmpdir(), 'wisconsin-runtime-pack-'));
	roots.push(site);
	const output = path.join(site, 'build/staged/cloudflare');
	write(output, '_app/immutable/main.js', 'neutral app');
	write(output, 'fonts/font.woff2', 'font');
	const appInventory = createAssetInventory(
		{
			'/_app/immutable/main.js': deploymentAsset(
				Buffer.from('neutral app'),
				'/_app/immutable/main.js'
			),
			'/fonts/font.woff2': deploymentAsset(Buffer.from('font'), '/fonts/font.woff2')
		},
		appVersion
	);
	return { site, output, appInventory };
}
function edition(site: string, selected: 'public' | 'full', body = 'Published note') {
	const note = {
		slug: 'course/note',
		title: 'Note',
		publication: { public: true },
		tags: [],
		html: body,
		toc: [],
		description: 'Published note'
	};
	const privateNote = {
		slug: 'course/private',
		title: 'Private note',
		publication: { public: false },
		tags: [],
		html: selected === 'public' ? '' : 'Secret body',
		markdown: selected === 'public' ? undefined : 'Secret source',
		description: '',
		locked: selected === 'public',
		toc: []
	};
	const manifest = {
		pages: { 'course/note': note, 'course/private': privateNote },
		folders: ['course'],
		tags: {},
		tree: { name: '', slug: '', title: '', children: [], pages: [] },
		assets: [],
		htmlAssets: []
	};
	write(site, 'build/generated/content-manifest.json', manifest);
	write(site, 'build/generated/pages/course/note.json', note);
	write(site, 'build/generated/pages/course/private.json', privateNote);
	write(site, 'src/lib/generated/nav.json', [
		{ title: 'Note', route: '/course/note', segment: 'note', children: [] }
	]);
	write(site, 'src/lib/generated/file-icons.json', { files: {}, folders: {} });
	const staticRoot = selected === 'public' ? 'build/generated/public-static' : 'static';
	write(site, `${staticRoot}/fonts/font.woff2`, 'font');
	write(site, `${staticRoot}/_files/index/course.json`, [
		{ path: 'note.md', kind: 'text', locked: selected === 'public' }
	]);
	if (selected === 'full') write(site, `${staticRoot}/_files/blobs/private.bin`, 'Secret file');
	const search = path.join(site, `build/search-${selected}`);
	write(search, 'pagefind/index.js', `search ${selected}`);
	return captureRuntimeEdition(
		site,
		selected,
		path.join(site, `build/metadata-${selected}-${body.length}`),
		search
	);
}
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('runtime packages hidden immutable snapshots, neutral public bootstrap aliases and one exact deployment inventory', () => {
	const { site, output, appInventory } = fixture();
	const publicEdition = edition(site, 'public');
	const fullEdition = edition(site, 'full');
	const packed = packageRuntime(
		site,
		output,
		appVersion,
		[publicEdition, fullEdition],
		appInventory
	);
	const current = readFileSync(path.join(output, '_content/current.json'));
	expect(packed.provenance).toBe(sha256(current));
	expect(JSON.parse(current.toString())).toEqual({
		schemaVersion: 1,
		applicationVersion: appVersion,
		snapshots: packed.snapshots
	});
	const publicRoot = path.join(output, '_content/public', packed.snapshots.public);
	const routing = JSON.parse(readFileSync(path.join(publicRoot, 'routing.json'), 'utf8'));
	expect(routing.assets['/_app/immutable/main.js']).toBe('/_app/immutable/main.js');
	expect(routing.assets['/fonts/font.woff2']).toBe('/fonts/font.woff2');
	expect(routing.assets['/pagefind/index.js']).toBe('/_published/pagefind/index.js');
	expect(routing.routes).toContain('/course/files/note.md');
	expect(Object.keys(routing.assets).some((key) => key.startsWith('/_content'))).toBe(false);
	expect(routing.htmlKeys['/course/note']).toMatch(/^[a-f0-9]{64}$/);
	const privateStub = JSON.parse(
		readFileSync(path.join(publicRoot, 'pages/course/private.json'), 'utf8')
	);
	expect(privateStub.html).toBe('');
	expect(privateStub.markdown).toBeUndefined();
	expect(existsSync(path.join(output, '_published/_files/blobs/private.bin'))).toBe(false);
	expect(readFileSync(path.join(output, '_files/blobs/private.bin'), 'utf8')).toBe('Secret file');
	expect(packed.inventory.assets['/_content/current.json'].sha256).toBe(packed.provenance);
	expect(
		packed.inventory.assets[`/_content/full/${packed.snapshots.full}/pages/course/private.json`]
	).toBeDefined();
});

test('content-only changes alter snapshot and affected HTML key without altering the application bytes', () => {
	const { site, output, appInventory } = fixture();
	const publicEdition = edition(site, 'public');
	const fullEdition = edition(site, 'full');
	const first = packageRuntime(
		site,
		output,
		appVersion,
		[publicEdition, fullEdition],
		appInventory
	);
	const oldRouting = JSON.parse(
		readFileSync(path.join(output, '_content/full', first.snapshots.full, 'routing.json'), 'utf8')
	);
	const changed = edition(site, 'full', 'Changed published note content');
	const second = packageRuntime(site, output, appVersion, [publicEdition, changed], appInventory);
	const newRouting = JSON.parse(
		readFileSync(path.join(output, '_content/full', second.snapshots.full, 'routing.json'), 'utf8')
	);
	expect(second.snapshots.full).not.toBe(first.snapshots.full);
	expect(second.snapshots.public).toBe(first.snapshots.public);
	expect(newRouting.htmlKeys['/course/note']).not.toBe(oldRouting.htmlKeys['/course/note']);
	expect(readFileSync(path.join(output, '_app/immutable/main.js'), 'utf8')).toBe('neutral app');
});

test('unsafe public PageDocs fail before any immutable snapshot or current descriptor is installed', () => {
	const { site, output } = fixture();
	edition(site, 'public');
	write(site, 'build/generated/pages/course/private.json', {
		slug: 'course/private',
		publication: { public: false },
		locked: true,
		html: 'Secret leaked body'
	});
	expect(() => captureRuntimeEdition(site, 'public', path.join(site, 'build/refused'))).toThrow(
		'publication'
	);
	expect(existsSync(path.join(output, '_content/current.json'))).toBe(false);
});

test('runtime promotion failure restores the previous complete canonical product', () => {
	const { site } = fixture();
	write(site, 'build/.svelte-kit/cloudflare/sentinel', 'previous deployed output');
	const staged = path.join(site, 'build/new-product');
	write(staged, 'cloudflare/sentinel', 'new output');
	const rename = fs.renameSync;
	const injected = spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
		if (String(source) === staged) throw new Error('Injected product promotion failure');
		return rename(source, destination);
	});
	try {
		expect(() => promoteRuntimeProduct(site, staged)).toThrow('Injected product promotion failure');
		expect(readFileSync(path.join(site, 'build/.svelte-kit/cloudflare/sentinel'), 'utf8')).toBe(
			'previous deployed output'
		);
	} finally {
		injected.mockRestore();
	}
});
