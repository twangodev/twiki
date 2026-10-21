import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
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
import {
	declaredContentCourses,
	discoverSourceFiles,
	discoverSourceEntries,
	parseProjectConfig,
	projectSourceFilter,
	resolveProject,
	withSourceDiscovery,
	writeProjectSiteConfig
} from '../../tooling/lib/project-config';
import { contentInputFingerprint } from '../../tooling/lib/dev-state';
import { contentRepositories } from '../../tooling/lib/dev-git-state';
import { courseFingerprint } from '../../tooling/lib/course-cache';
import { preflightRmdPreviews } from '../../tooling/lib/rmd-preflight';
import { buildGitDateMap } from '../../tooling/lib/lastmod';
import { publicationResolver } from '../../tooling/lib/publishing';

const git = (root: string, ...args: string[]) =>
	execFileSync('git', ['-C', root, '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' });
function temporary() {
	return mkdtempSync(path.join(tmpdir(), 'twiki-project-'));
}
async function withEnvironment<T>(
	environment: NodeJS.ProcessEnv,
	run: () => T | Promise<T>
): Promise<T> {
	const names = [
		'TWIKI_PROJECT_ROOT',
		'TWIKI_CONFIG_FILE',
		'TWIKI_CONTENT_DIR',
		'TWIKI_CONTENT_REPO'
	];
	const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
	try {
		for (const name of names) {
			if (environment[name] === undefined) delete process.env[name];
			else process.env[name] = environment[name];
		}
		return await run();
	} finally {
		for (const name of names) {
			if (saved[name] === undefined) delete process.env[name];
			else process.env[name] = saved[name];
		}
	}
}

describe('consumer project configuration and discovery', () => {
	test('build discovery is shared only within its async snapshot and never leaks between projects', async () => {
		const root = temporary();
		try {
			mkdirSync(path.join(root, 'notes'));
			mkdirSync(path.join(root, 'other'));
			writeFileSync(path.join(root, 'notes/first.md'), '# First');
			writeFileSync(path.join(root, 'other/second.md'), '# Second');
			const project = resolveProject(root, undefined, {
				TWIKI_PROJECT_ROOT: root,
				TWIKI_CONTENT_DIR: path.join(root, 'notes')
			});
			const other = resolveProject(root, undefined, {
				TWIKI_PROJECT_ROOT: root,
				TWIKI_CONTENT_DIR: path.join(root, 'other')
			});
			await withSourceDiscovery(async () => {
				expect(discoverSourceFiles(project)).toEqual(['first.md']);
				const original = discoverSourceEntries(project)[0].stat;
				writeFileSync(path.join(root, 'notes/first.md'), '# Changed during build');
				expect(discoverSourceEntries(project)[0].stat.size).toBe(original.size);
				writeFileSync(path.join(root, 'notes/added.md'), '# Added during build');
				await Promise.resolve();
				const files = discoverSourceFiles(project);
				expect(files).toEqual(['first.md']);
				files.length = 0;
				expect(discoverSourceFiles(project)).toEqual(['first.md']);
				expect(discoverSourceFiles(other)).toEqual(['second.md']);
			});
			expect(discoverSourceFiles(project)).toEqual(['added.md', 'first.md']);
			expect(
				discoverSourceEntries(project).find((file) => file.relative === 'first.md')?.stat.size
			).toBe(BigInt(Buffer.byteLength('# Changed during build')));
			await expect(
				withSourceDiscovery(async () => {
					throw new Error('failed build');
				})
			).rejects.toThrow('failed build');
			expect(discoverSourceFiles(project)).toEqual(['added.md', 'first.md']);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	test('plain vault defaults are private and independent of staged engine path', async () => {
		const root = temporary();
		try {
			mkdirSync(path.join(root, 'notes'));
			writeFileSync(path.join(root, 'notes/index.md'), '# Vault');
			const project = resolveProject('/unrelated/installed/package/site', undefined, {
				TWIKI_PROJECT_ROOT: root,
				TWIKI_CONTENT_DIR: path.join(root, 'notes')
			});
			expect(project.root).toBe(root);
			expect(project.contentDir).toBe(path.join(root, 'notes'));
			expect(project.discovery).toBe('filesystem');
			expect(project.publication).toBe('private');
			expect(project.site.name).toBe('twiki');
			expect(project.site.author.name).toBe('');
			expect(publicationResolver(root, project)('index.md').public).toBe(false);
			expect(declaredContentCourses(project)).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	test('prepared source policy preserves project and custom configuration boundaries', () => {
		const root = temporary();
		try {
			const base = resolveProject('/unrelated/site', undefined, { TWIKI_PROJECT_ROOT: root });
			for (const nested of [false, true]) {
				const project = {
					...base,
					contentDir: nested ? path.join(root, 'vault') : root,
					configFile: path.join(root, nested ? 'vault/settings/engine.ts' : 'settings/engine.ts'),
					publication: 'public' as const
				};
				const visible = projectSourceFilter(project);
				const published = publicationResolver(root, project);
				for (const file of [
					'settings/engine.ts',
					'../outside.md',
					'nested/../outside.md',
					'.env',
					'keys/private.key'
				]) {
					expect(visible(file)).toBe(false);
					expect(published(file).public).toBe(false);
				}
				for (const file of ['index.md', 'settings/example.ts', 'nested/package.json']) {
					expect(visible(file)).toBe(true);
					expect(published(file).public).toBe(true);
				}
				mkdirSync(path.join(project.contentDir, 'settings'), { recursive: true });
				writeFileSync(project.configFile, 'export default { version: 1 };');
				writeFileSync(
					path.join(project.contentDir, 'settings/example.ts'),
					'export const example = true;'
				);
				const discovered = discoverSourceFiles(project);
				expect(discovered).not.toContain('settings/engine.ts');
				expect(discovered).toContain('settings/example.ts');
				expect(visible('package.json')).toBe(nested);
				expect(visible('publish.yaml')).toBe(true);
				expect(published('publish.yaml').public).toBe(false);
				const externalConfig = projectSourceFilter({
					...project,
					configFile: path.join(root, '../outside/engine.ts')
				});
				expect(externalConfig('settings/engine.ts')).toBe(true);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	test('configuration validates JSON, merges branding, and writes only staged metadata', async () => {
		const root = temporary();
		try {
			const vault = path.join(root, 'vault');
			const staged = path.join(root, '.twiki/site');
			mkdirSync(vault);
			writeFileSync(path.join(vault, 'index.md'), '# Original');
			const config = path.join(root, 'twiki.config.json');
			writeFileSync(
				config,
				JSON.stringify({
					version: 1,
					contentDir: 'vault',
					publication: 'public',
					site: { title: 'My Notes', url: 'https://notes.example', author: { name: 'A Writer' } },
					cloudflare: { name: 'notes' }
				})
			);
			const project = resolveProject(staged, undefined, {
				TWIKI_PROJECT_ROOT: root,
				TWIKI_CONFIG_FILE: config
			});
			expect(project.site.title).toBe('My Notes');
			expect(project.site.author.name).toBe('A Writer');
			expect(project.site.author.github).toBe('');
			expect(project.cloudflare).toEqual({ name: 'notes' });
			expect(publicationResolver(root, project)('index.md').public).toBe(true);
			writeProjectSiteConfig(staged, project);
			expect(
				JSON.parse(readFileSync(path.join(staged, 'src/lib/site-config.json'), 'utf8')).title
			).toBe('My Notes');
			expect(readFileSync(path.join(vault, 'index.md'), 'utf8')).toBe('# Original');
			expect(existsSync(path.join(vault, 'src'))).toBe(false);
			expect(() => resolveProject(staged, root, { TWIKI_CONFIG_FILE: 'relative.json' })).toThrow(
				'must be absolute'
			);
			for (const input of [
				{ version: 2 },
				{ version: 1, publication: ['public'] },
				{ version: 1, discovery: 'shell' },
				{ version: 1, site: { url: 'javascript:alert(1)' } },
				{ version: 1, site: { author: { name: 4 } } }
			])
				expect(() => parseProjectConfig(input)).toThrow();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	test('filesystem discovery includes untracked visible notes and attachments but skips hidden state, secrets and symlinks', async () => {
		const root = temporary();
		try {
			for (const dir of ['folder', '.obsidian', '.twiki', 'node_modules', 'credentials'])
				mkdirSync(path.join(root, dir));
			for (const name of [
				'index.md',
				'folder/second.md',
				'folder/image.png',
				'twiki.config.json',
				'package.json',
				'bun.lock',
				'folder/package.json',
				'.obsidian/config.json',
				'.twiki/generated.md',
				'node_modules/junk.md',
				'credentials/token.md',
				'publish.yaml'
			])
				writeFileSync(
					path.join(root, name),
					name === 'twiki.config.json' ? JSON.stringify({ version: 1 }) : name
				);
			const outside = path.join(tmpdir(), `twiki-outside-${process.pid}.md`);
			writeFileSync(outside, 'private');
			try {
				symlinkSync(outside, path.join(root, 'linked.md'));
				symlinkSync(path.join(root, 'folder'), path.join(root, 'linked-folder'));
				expect(
					discoverSourceFiles(resolveProject(root, root, { TWIKI_PROJECT_ROOT: root }))
				).toEqual([
					'folder/image.png',
					'folder/package.json',
					'folder/second.md',
					'index.md',
					'publish.yaml'
				]);
			} finally {
				rmSync(outside, { force: true });
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	test('plain-vault dev snapshots detect offline edits, additions and removals without Git', async () => {
		const root = temporary();
		try {
			writeFileSync(path.join(root, 'index.md'), 'one');
			await withEnvironment({ TWIKI_PROJECT_ROOT: root }, async () => {
				expect(await contentRepositories(root)).toEqual([]);
				const initial = await contentInputFingerprint(root, 'pipeline');
				writeFileSync(path.join(root, 'index.md'), 'two');
				expect(await contentInputFingerprint(root, 'pipeline')).not.toBe(initial);
				const edit = await contentInputFingerprint(root, 'pipeline');
				writeFileSync(path.join(root, 'added.md'), 'added');
				expect(await contentInputFingerprint(root, 'pipeline')).not.toBe(edit);
				rmSync(path.join(root, 'added.md'));
				expect(await contentInputFingerprint(root, 'pipeline')).toBe(edit);
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	test('portable course fingerprints support custom roots and a course named content', async () => {
		const root = temporary();
		try {
			const content = path.join(root, 'vault');
			mkdirSync(path.join(content, 'content'), { recursive: true });
			writeFileSync(path.join(content, 'content/code.txt'), 'first');
			const initial = courseFingerprint(
				root,
				'content',
				['content/code.txt'],
				'version',
				'[]',
				content
			);
			writeFileSync(path.join(content, 'content/code.txt'), 'other');
			expect(
				courseFingerprint(root, 'content', ['content/code.txt'], 'version', '[]', content)
			).not.toBe(initial);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	test('external Git vaults use their own repository for discovery, snapshots and dates', async () => {
		const root = temporary();
		try {
			const projectRoot = path.join(root, 'project');
			const vault = path.join(root, 'vault');
			mkdirSync(projectRoot);
			mkdirSync(vault);
			git(projectRoot, 'init');
			git(vault, 'init');
			writeFileSync(path.join(vault, 'index.md'), '# Original');
			git(vault, 'add', 'index.md');
			git(
				vault,
				'-c',
				'user.name=Fixture',
				'-c',
				'user.email=fixture@example.invalid',
				'commit',
				'-m',
				'note'
			);
			writeFileSync(
				path.join(projectRoot, 'twiki.config.json'),
				JSON.stringify({
					version: 1,
					contentDir: '../vault',
					discovery: 'git',
					publication: 'private'
				})
			);
			const project = resolveProject(projectRoot, projectRoot, { TWIKI_PROJECT_ROOT: projectRoot });
			expect(discoverSourceFiles(project)).toEqual(['index.md']);
			await withEnvironment({ TWIKI_PROJECT_ROOT: projectRoot }, async () => {
				expect((await contentRepositories(projectRoot)).map((repo) => repo.directory)).toEqual([
					vault
				]);
				expect(await contentInputFingerprint(projectRoot, 'pipeline')).toBeString();
			});
			expect(
				buildGitDateMap(projectRoot, path.join(root, 'cache'), project).modified['index.md']
			).toBeGreaterThan(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	test('R preflight handles a plain vault and configured Git content roots without legacy content paths', async () => {
		const root = temporary();
		try {
			writeFileSync(path.join(root, 'worksheet.Rmd'), '# Worksheet');
			expect(
				await preflightRmdPreviews(path.join(root, '.twiki/site'), root, {
					TWIKI_PROJECT_ROOT: root
				})
			).toMatchObject({ requiresR: false, reason: 'unused' });
			const vault = path.join(root, 'vault');
			const course = path.join(vault, 'example-course');
			mkdirSync(course, { recursive: true });
			git(root, 'init');
			git(course, 'init');
			writeFileSync(
				path.join(root, '.gitmodules'),
				'[submodule \"example\"]\npath = vault/example-course\n'
			);
			writeFileSync(path.join(course, 'worksheet.Rmd'), '# Worksheet\n');
			git(course, 'add', 'worksheet.Rmd');
			git(root, 'add', '.gitmodules');
			writeFileSync(
				path.join(root, 'twiki.config.json'),
				JSON.stringify({
					version: 1,
					contentDir: 'vault',
					discovery: 'git',
					publication: 'private'
				})
			);
			expect(
				await preflightRmdPreviews(path.join(root, '.twiki/site'), root, {
					TWIKI_PROJECT_ROOT: root
				})
			).toMatchObject({ requiresR: true, worksheets: 1, reason: 'profile-or-fonts' });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	test('legacy Git roots retain tracked-only discovery and declared initialized unindexed courses', async () => {
		const root = temporary();
		try {
			const content = path.join(root, 'content');
			const course = path.join(content, 'test-course');
			mkdirSync(course, { recursive: true });
			git(root, 'init');
			writeFileSync(path.join(content, 'index.md'), 'root');
			writeFileSync(
				path.join(root, '.gitmodules'),
				'[submodule "test"]\npath = content/test-course\n'
			);
			git(root, 'add', 'content/index.md', '.gitmodules');
			git(course, 'init');
			writeFileSync(path.join(course, 'README.md'), 'course');
			git(course, 'add', 'README.md');
			writeFileSync(path.join(content, 'untracked.md'), 'no');
			const project = resolveProject(path.join(root, 'site'), root, {});
			expect(project.discovery).toBe('git');
			expect(project.publication).toBe('policies');
			expect(discoverSourceFiles(project)).toEqual(['index.md', 'test-course/README.md']);
			expect(declaredContentCourses(project)).toEqual([{ name: 'test-course', directory: course }]);
			await withEnvironment({}, async () =>
				expect(await contentRepositories(root)).toHaveLength(2)
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
