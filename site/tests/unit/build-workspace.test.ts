import { afterEach, expect, spyOn, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBuildWorkspaces, mergeBuildCaches } from '../../tooling/lib/build-workspace';

const fixtures: string[] = [];
function fixture() {
	const root = mkdtempSync(path.join(tmpdir(), 'wisconsin-build-workspace-'));
	fixtures.push(root);
	const site = path.join(root, 'site');
	mkdirSync(site);
	write(site, 'package.json', '{"type":"module"}');
	write(site, 'src/routes/+page.svelte', '<p>Maintained application</p>');
	write(site, 'tooling/compiler.ts', 'export const current = true;');
	write(site, 'worker/index.ts', 'export default {};');
	write(site, 'static/.gitignore', '*\n!.gitignore\n!favicon.png\n!fonts/\n!fonts/**\n');
	write(site, 'static/favicon.png', 'favicon');
	write(site, 'static/fonts/font.woff2', 'font');
	return { root, site };
}
function write(root: string, filename: string, value: string | unknown[] | object) {
	const target = path.join(root, filename);
	mkdirSync(path.dirname(target), { recursive: true });
	writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
}
const read = (root: string, file: string) => readFileSync(path.join(root, file), 'utf8');
const cacheOf = (site: string) => path.join(site, 'build/generated/cache');
const parse = `stage1/aa/${'a'.repeat(64)}.json`;
const otherParse = `stage1/bb/${'b'.repeat(64)}.json`;
const staleParse = `stage1/cc/${'c'.repeat(64)}.json`;
const publicCard = `social-titles/${'d'.repeat(64)}.png`;
const fullCard = `social-titles/${'e'.repeat(64)}.png`;

function manifests(
	site: string,
	parser: string[] = [],
	publicCards: string[] = [],
	fullCards: string[] = []
) {
	const cache = cacheOf(site);
	write(cache, 'stage1-current.json', parser);
	write(cache, 'social-titles-current-public.json', publicCards);
	write(cache, 'social-titles-current-full.json', fullCards);
	return cache;
}

afterEach(() => {
	for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('Git snapshot captures maintained dirty/untracked source and env once, with independent dependencies and selected caches', async () => {
	const { root, site } = fixture();
	write(site, '.gitignore', 'build/\nnode_modules/\nsrc/lib/generated/\n.env*\n');
	execFileSync('git', ['init', '-q', site]);
	execFileSync('git', ['-C', site, 'add', '.']);
	write(site, 'src/routes/+page.svelte', '<p>Uncommitted application change</p>');
	write(site, 'tooling/new-helper.ts', 'export const untracked = true;');
	write(site, '.env.production', 'PUBLIC_ORIGIN=https://fixture.example');
	write(site, 'src/lib/generated/nav.json', 'generated navigation');
	write(site, 'static/course/private.png', 'private generated asset');
	write(site, 'build/.svelte-kit/cloudflare/index.html', 'previous successful deployment');
	write(site, 'build/edition-runs/previous/sentinel', 'previous workspace');
	write(site, 'node_modules/library/index.js', 'installed dependency');
	for (const cache of ['.vite', '.vite-temp', '.cache'])
		write(site, `node_modules/${cache}/state`, 'old dependency cache');
	mkdirSync(path.join(site, 'node_modules/.bin'));
	symlinkSync('../library/index.js', path.join(site, 'node_modules/.bin/library'));
	symlinkSync(
		path.join(site, 'node_modules/library/index.js'),
		path.join(site, 'node_modules/absolute')
	);
	const stamp = new Date('2025-01-01T00:00:00Z');
	utimesSync(path.join(site, 'node_modules/library/index.js'), stamp, stamp);
	const cache = manifests(site, [parse]);
	write(cache, parse, 'live parse');
	write(cache, staleParse, 'old parse generation');
	write(cache, 'course-files/course.json', 'absolute-path output stamps');
	write(cache, 'file-history/course/current.json', 'live history');
	write(cache, 'file-history/course/stale.json', 'old history');
	write(site, 'build/generated/assets/_files/history/current.json', 'deployed history');
	const workspaces = await createBuildWorkspaces(site, root);
	try {
		expect(workspaces.setupSeconds).toBeGreaterThanOrEqual(0);
		for (const snapshot of [workspaces.publicSite, workspaces.fullSite]) {
			expect(read(snapshot, 'src/routes/+page.svelte')).toContain('Uncommitted');
			expect(read(snapshot, 'tooling/new-helper.ts')).toContain('untracked');
			expect(read(snapshot, '.env.production')).toContain('fixture.example');
			expect(read(snapshot, 'static/fonts/font.woff2')).toBe('font');
			expect(read(snapshot, 'static/favicon.png')).toBe('favicon');
			for (const missing of [
				'src/lib/generated',
				'static/course',
				'build/.svelte-kit',
				'build/edition-runs',
				'node_modules/.vite',
				'node_modules/.vite-temp',
				'node_modules/.cache'
			])
				expect(existsSync(path.join(snapshot, missing))).toBe(false);
			expect(read(cacheOf(snapshot), parse)).toBe('live parse');
			expect(read(cacheOf(snapshot), 'file-history/course/current.json')).toBe('live history');
			for (const missing of [
				staleParse,
				'course-files/course.json',
				'file-history/course/stale.json'
			])
				expect(existsSync(path.join(cacheOf(snapshot), missing))).toBe(false);
			expect(statSync(path.join(snapshot, 'node_modules/library/index.js')).mtimeMs).toBe(
				stamp.getTime()
			);
			expect(path.isAbsolute(readlinkSync(path.join(snapshot, 'node_modules/absolute')))).toBe(
				false
			);
			expect(realpathSync(path.join(snapshot, 'node_modules/absolute'))).toBe(
				path.join(snapshot, 'node_modules/library/index.js')
			);
		}
		const publicDependency = path.join(workspaces.publicSite, 'node_modules/library/index.js');
		const fullDependency = path.join(workspaces.fullSite, 'node_modules/library/index.js');
		expect(statSync(publicDependency).ino).not.toBe(statSync(fullDependency).ino);
		expect(statSync(fullDependency).ino).not.toBe(
			statSync(path.join(site, 'node_modules/library/index.js')).ino
		);
		write(workspaces.publicSite, 'node_modules/library/index.js', 'public-only dependency edit');
		write(workspaces.publicSite, 'src/routes/+page.svelte', 'public-only source edit');
		write(cacheOf(workspaces.publicSite), parse, 'public-only cache edit');
		expect(read(workspaces.fullSite, 'node_modules/library/index.js')).toBe('installed dependency');
		expect(read(workspaces.fullSite, 'src/routes/+page.svelte')).toContain('Uncommitted');
		expect(read(cacheOf(workspaces.fullSite), parse)).toBe('live parse');
		expect(read(cache, parse)).toBe('live parse');
	} finally {
		workspaces.cleanup();
		workspaces.cleanup();
	}
	expect(existsSync(workspaces.directory)).toBe(false);
	expect(read(site, 'build/.svelte-kit/cloudflare/index.html')).toBe(
		'previous successful deployment'
	);
	expect(read(site, 'build/edition-runs/previous/sentinel')).toBe('previous workspace');
});

test('Git-free snapshot excludes generated content and retains the standard maintained assets', async () => {
	const { root, site } = fixture();
	write(site, 'src/lib/generated/nav.json', 'generated');
	write(site, 'static/course/note.html', 'generated');
	write(site, 'build/generated/content-manifest.json', 'generated');
	write(site, '.env.local', 'PUBLIC_NAME=fixture');
	const workspaces = await createBuildWorkspaces(site, root);
	try {
		for (const snapshot of [workspaces.publicSite, workspaces.fullSite]) {
			expect(read(snapshot, 'src/routes/+page.svelte')).toContain('Maintained');
			expect(read(snapshot, 'static/fonts/font.woff2')).toBe('font');
			expect(read(snapshot, '.env.local')).toBe('PUBLIC_NAME=fixture');
			for (const missing of ['static/course', 'src/lib/generated', 'build'])
				expect(existsSync(path.join(snapshot, missing))).toBe(false);
		}
	} finally {
		workspaces.cleanup();
	}
});

test('cache-only restored runner seeds and merges current history without generated assets', async () => {
	const { root, site } = fixture();
	const cache = manifests(site);
	const history = `file-history/course/${'a'.repeat(64)}.json`;
	const blame = `file-history/course/${'a'.repeat(64)}-blame.json`;
	const stale = `file-history/course/${'b'.repeat(64)}.json`;
	write(cache, history, 'current history');
	write(cache, blame, 'current blame');
	write(cache, stale, 'stale history');
	write(cache, 'history-current.json', [history, blame]);
	expect(existsSync(path.join(site, 'build/generated/assets'))).toBe(false);
	const workspaces = await createBuildWorkspaces(site, root);
	try {
		for (const snapshot of [workspaces.publicSite, workspaces.fullSite]) {
			expect(read(cacheOf(snapshot), history)).toBe('current history');
			expect(read(cacheOf(snapshot), blame)).toBe('current blame');
			expect(existsSync(path.join(cacheOf(snapshot), stale))).toBe(false);
		}
		write(cacheOf(workspaces.publicSite), 'history-current.json', []);
		write(
			cacheOf(workspaces.publicSite),
			history,
			'public inherited history must not override full'
		);
		const target = cacheOf(workspaces.fullSite);
		mergeBuildCaches(workspaces.publicSite, workspaces.fullSite, target);
		expect(JSON.parse(read(target, 'history-current.json'))).toEqual([blame, history].sort());
		expect(read(target, history)).toBe('current history');
		expect(read(target, blame)).toBe('current blame');
		expect(read(cache, history)).toBe('current history');
	} finally {
		workspaces.cleanup();
	}
});

test('partial source-copy failure removes only its own run and preserves earlier artifacts', async () => {
	const { root, site } = fixture();
	write(root, 'outside.ts', 'external source');
	symlinkSync(path.join(root, 'outside.ts'), path.join(site, 'tooling/external.ts'));
	write(site, 'build/edition-runs/previous/sentinel', 'prior artifact');
	await expect(createBuildWorkspaces(site, root)).rejects.toThrow('owned regular file');
	expect(readdirSync(path.join(site, 'build/edition-runs'))).toEqual(['previous']);
	expect(read(site, 'build/edition-runs/previous/sentinel')).toBe('prior artifact');
	expect(read(root, 'outside.ts')).toBe('external source');
});

test('external dependency symlinks fail setup rather than sharing a writable installed tree', async () => {
	const { root, site } = fixture();
	write(root, 'external-dependency/index.js', 'external dependency');
	mkdirSync(path.join(site, 'node_modules'));
	symlinkSync(path.join(root, 'external-dependency'), path.join(site, 'node_modules/library'));
	await expect(createBuildWorkspaces(site, root)).rejects.toThrow('Dependency symlink');
	expect(readdirSync(path.join(site, 'build/edition-runs'))).toEqual([]);
});

test('merged cache contains live parser union, each own-edition social manifest and authoritative full history', () => {
	const publicSite = fixture().site;
	const fullSite = fixture().site;
	const publicCache = manifests(publicSite, [parse, parse], [publicCard], [fullCard]);
	const fullCache = manifests(fullSite, [otherParse, parse], [publicCard], [fullCard]);
	for (const cache of [publicCache, fullCache]) {
		write(cache, parse, 'shared parser');
		write(cache, staleParse, 'stale seeded parser');
		write(cache, 'course-files/course.json', 'absolute output paths');
	}
	write(publicCache, publicCard, 'public image');
	write(fullCache, fullCard, 'full image');
	write(fullCache, otherParse, 'second parser');
	write(publicCache, fullCard, 'stale inherited full image');
	write(fullCache, publicCard, 'stale inherited public image');
	write(fullCache, 'file-history/course/current.json', 'full history');
	write(fullCache, 'file-history/course/stale.json', 'old unreferenced history');
	write(fullCache, 'file-history/course/revisions-version-head.jsonl', 'full revision metadata');
	write(
		publicCache,
		'file-history/course/revisions-version-head.jsonl',
		'different public revisions'
	);
	write(fullSite, 'build/generated/assets/_files/history/current.json', 'deployed history');
	write(fullCache, 'gitdates-v3-course-version-head.json', 'full git dates');
	write(publicCache, 'gitdates-v3-course-version-head.json', 'different public git dates');
	const merged = mergeBuildCaches(publicSite, fullSite, fullCache);
	expect(merged.files).toBe(10);
	expect(JSON.parse(read(fullCache, 'stage1-current.json'))).toEqual([parse, otherParse]);
	expect(JSON.parse(read(fullCache, 'social-titles-current-public.json'))).toEqual([publicCard]);
	expect(JSON.parse(read(fullCache, 'social-titles-current-full.json'))).toEqual([fullCard]);
	expect(read(fullCache, publicCard)).toBe('public image');
	expect(read(fullCache, fullCard)).toBe('full image');
	expect(read(fullCache, 'file-history/course/current.json')).toBe('full history');
	expect(read(fullCache, 'file-history/course/revisions-version-head.jsonl')).toBe(
		'full revision metadata'
	);
	expect(read(fullCache, 'gitdates-v3-course-version-head.json')).toBe('full git dates');
	for (const missing of [staleParse, 'course-files', 'file-history/course/stale.json'])
		expect(existsSync(path.join(fullCache, missing))).toBe(false);
	expect(read(publicCache, parse)).toBe('shared parser');
});

test('conflicting immutable entries leave the target and both successful edition caches unchanged', () => {
	const publicSite = fixture().site;
	const fullSite = fixture().site;
	const target = cacheOf(fixture().site);
	const publicCache = manifests(publicSite, [parse]);
	const fullCache = manifests(fullSite, [parse]);
	write(publicCache, parse, 'public conflicting bytes');
	write(fullCache, parse, 'full conflicting bytes');
	write(target, 'sentinel', 'previous cache');
	expect(() => mergeBuildCaches(publicSite, fullSite, target)).toThrow('Conflicting immutable');
	expect(readdirSync(target)).toEqual(['sentinel']);
	expect(read(target, 'sentinel')).toBe('previous cache');
	expect(read(publicCache, parse)).toBe('public conflicting bytes');
	expect(read(fullCache, parse)).toBe('full conflicting bytes');
});

test('cache promotion failure restores the prior target and removes only its own transaction', () => {
	const publicSite = fixture().site;
	const fullSite = fixture().site;
	const target = cacheOf(fixture().site);
	manifests(publicSite);
	manifests(fullSite);
	write(target, 'sentinel', 'previous cache');
	const rename = fs.renameSync;
	const injected = spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
		if (path.basename(String(source)) === 'cache' && String(source).includes('.cache-merge-'))
			throw new Error('Injected cache promotion failure');
		return rename(source, destination);
	});
	try {
		expect(() => mergeBuildCaches(publicSite, fullSite, target)).toThrow(
			'Injected cache promotion failure'
		);
		expect(read(target, 'sentinel')).toBe('previous cache');
		expect(readdirSync(path.dirname(target))).toEqual(['cache']);
	} finally {
		injected.mockRestore();
	}
});

test('failed cache rollback retains the previous cache backup for recovery', () => {
	const publicSite = fixture().site;
	const fullSite = fixture().site;
	const target = cacheOf(fixture().site);
	manifests(publicSite);
	manifests(fullSite);
	write(target, 'sentinel', 'previous cache');
	const rename = fs.renameSync;
	const injected = spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
		if (String(source).includes('.cache-merge-')) throw new Error('Injected rename failure');
		return rename(source, destination);
	});
	try {
		expect(() => mergeBuildCaches(publicSite, fullSite, target)).toThrow(
			'previous cache preserved'
		);
		const transaction = readdirSync(path.dirname(target)).find((name) =>
			name.startsWith('.cache-merge-')
		)!;
		expect(read(path.join(path.dirname(target), transaction, 'previous'), 'sentinel')).toBe(
			'previous cache'
		);
	} finally {
		injected.mockRestore();
	}
});

test('invalid live manifests and symlink entries fail cold without carrying stale seed selections', () => {
	const publicSite = fixture().site;
	const fullSite = fixture().site;
	const target = cacheOf(fixture().site);
	const publicCache = manifests(publicSite, [parse]);
	const fullCache = manifests(fullSite);
	write(publicCache, 'stage1-current.json', [parse, '../../outside.json']);
	write(publicCache, parse, 'untrusted selection');
	write(fullCache, 'social-titles-current-full.json', [fullCard]);
	write(publicCache, 'social-titles-current-public.json', '{');
	symlinkSync(path.join(publicCache, parse), path.join(fullCache, 'external.png'));
	mkdirSync(path.join(fullCache, 'social-titles'));
	symlinkSync(path.join(publicCache, parse), path.join(fullCache, fullCard));
	write(target, 'stage1-current.json', [staleParse]);
	write(target, staleParse, 'stale seed');
	mergeBuildCaches(publicSite, fullSite, target);
	expect(JSON.parse(read(target, 'stage1-current.json'))).toEqual([]);
	expect(JSON.parse(read(target, 'social-titles-current-full.json'))).toEqual([]);
	expect(existsSync(path.join(target, 'social-titles-current-public.json'))).toBe(false);
	expect(existsSync(path.join(target, staleParse))).toBe(false);
	expect(existsSync(path.join(target, fullCard))).toBe(false);
});

test('R merge retains complete referenced blob sets and excludes incomplete or traversing records', () => {
	const publicSite = fixture().site;
	const fullSite = fixture().site;
	const publicCache = manifests(publicSite);
	const fullCache = manifests(fullSite);
	const preview = `${'f'.repeat(64)}.json`;
	const figure = `${'a'.repeat(64)}.png`;
	for (const cache of [publicCache, fullCache]) {
		write(cache, 'rmd/complete/result.json', { preview, blobs: [preview, figure] });
		write(cache, `rmd/complete/${preview}`, '{"html":"knitted preview"}');
		write(cache, `rmd/complete/${figure}`, 'rendered figure');
	}
	write(fullCache, 'rmd/complete/unreferenced.json', 'unused stale blob');
	write(fullCache, 'rmd/incomplete/result.json', { preview, blobs: [preview, figure] });
	write(fullCache, `rmd/incomplete/${preview}`, 'preview without its figure');
	write(fullCache, 'rmd/traversal/result.json', {
		preview,
		blobs: [preview, '../../outside.json']
	});
	write(fullCache, `rmd/traversal/${preview}`, 'preview');
	mergeBuildCaches(publicSite, fullSite, fullCache);
	expect(readdirSync(path.join(fullCache, 'rmd'))).toEqual(['complete']);
	expect(readdirSync(path.join(fullCache, 'rmd/complete')).sort()).toEqual(
		[figure, preview, 'result.json'].sort()
	);
	expect(read(fullCache, `rmd/complete/${figure}`)).toBe('rendered figure');
	expect(lstatSync(path.join(fullCache, `rmd/complete/${figure}`)).ino).not.toBe(
		lstatSync(path.join(publicCache, `rmd/complete/${figure}`)).ino
	);
});
