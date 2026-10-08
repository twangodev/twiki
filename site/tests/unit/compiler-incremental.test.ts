import { expect, test, spyOn } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compileContent } from '../../tooling/compiler';

function fixture() {
	const root = mkdtempSync(path.join(tmpdir(), 'wisconsin-incremental-'));
	const course = path.join(root, 'content/course');
	const site = path.join(root, 'site');
	mkdirSync(course, { recursive: true });
	mkdirSync(site);
	const git = (directory: string, ...args: string[]) =>
		execFileSync(
			'git',
			[
				'-C',
				directory,
				'-c',
				'commit.gpgsign=false',
				'-c',
				'user.name=Fixture',
				'-c',
				'user.email=fixture@example.test',
				...args
			],
			{ stdio: 'pipe' }
		);
	git(root, 'init');
	git(course, 'init');
	writeFileSync(path.join(root, '.gitmodules'), '[submodule "course"]\npath = content/course\n');
	const write = (relative: string, bytes: string) => {
		const file = path.join(course, relative);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, bytes);
	};
	write('README.md', '# Course\n\n[[source]] [[target]]\n');
	write('source.md', '# Source\n\n[[target]]\n');
	write('target.md', '# Target\n\n## Details\n\nTarget content.\n');
	write('unrelated.md', '# Unrelated\n\nUnchanged content.\n');
	write('publish.yaml', 'include:\n  - "**"\n');
	git(course, 'add', '.');
	git(course, 'commit', '-m', 'Fixture');
	git(root, 'add', '.gitmodules');
	git(root, 'commit', '-m', 'Fixture course registration');
	const run = async (incremental = true, publicEdition = false, destination = site) => {
		const logs: string[] = [];
		const log = spyOn(console, 'log').mockImplementation((value) => logs.push(String(value)));
		try {
			await compileContent({ siteDir: destination, repoRoot: root, publicEdition, incremental });
		} finally {
			log.mockRestore();
		}
		return logs.join('\n');
	};
	const pages = (directory = site) => {
		const base = path.join(directory, 'build/generated/pages');
		return Object.fromEntries(
			readdirSync(base, { recursive: true, withFileTypes: true })
				.filter((entry) => entry.isFile())
				.map((entry) => {
					const file = path.join(entry.parentPath, entry.name);
					return [path.relative(base, file), readFileSync(file, 'utf8')];
				})
		);
	};
	const reference = async (publicEdition = false) => {
		const destination = path.join(root, 'reference');
		mkdirSync(destination, { recursive: true });
		await run(false, publicEdition, destination);
		expect(pages()).toEqual(pages(destination));
	};
	return {
		root,
		course,
		site,
		git,
		write,
		run,
		pages,
		reference,
		cleanup: () => rmSync(root, { recursive: true, force: true })
	};
}

test('identical and ordinary note builds skip unchanged ASTs and body serialization while updating backlinks and recovering missing outputs', async () => {
	const f = fixture();
	try {
		await f.run();
		const unchanged = path.join(f.site, 'build/generated/pages/course/unrelated.json');
		const stamp = statSync(unchanged).mtimeMs;
		expect(await f.run()).toContain('incremental resolution, 0 dirty bodies, 0 ASTs loaded');
		f.write('source.md', '# Renamed source title\n\n[[target]]\n\nEdited body.\n');
		expect(await f.run()).toContain('incremental resolution, 1 dirty bodies, 1 ASTs loaded');
		expect(statSync(unchanged).mtimeMs).toBe(stamp);
		expect(JSON.parse(f.pages()['course/target.json']).backlinks).toContainEqual({
			slug: 'course/source',
			title: 'Renamed source title'
		});
		await f.reference();
		rmSync(unchanged);
		expect(await f.run()).toContain('incremental resolution, 0 dirty bodies, 0 ASTs loaded');
		expect(existsSync(unchanged)).toBe(true);
		const cache = path.join(f.site, 'build/generated/cache');
		const index = JSON.parse(readFileSync(path.join(cache, 'content-current-full.json'), 'utf8'));
		writeFileSync(path.join(cache, index.pages['course/unrelated.md'].body), '{}');
		expect(await f.run()).toContain('incremental resolution, 1 dirty bodies, 1 ASTs loaded');
		await f.reference();
	} finally {
		f.cleanup();
	}
}, 20_000);

test('new/deleted/renamed paths and transclusion changes preserve full compiler output and prune obsolete PageDocs', async () => {
	const f = fixture();
	try {
		f.write('source.md', '# Source\n\n![[target#Details]]\n');
		await f.run();
		f.write('target.md', '# Target\n\n## Details\n\nChanged embedded content.\n');
		expect(await f.run()).toContain('full resolution fallback');
		expect(JSON.parse(f.pages()['course/source.json']).html).toContain('Changed embedded content');
		await f.reference();
		f.write('nested/target.md', '# A new ambiguous target\n');
		f.git(f.course, 'add', '.');
		expect(await f.run()).toContain('full resolution fallback');
		await f.reference();
		f.git(f.course, 'mv', 'unrelated.md', 'renamed.md');
		expect(await f.run()).toContain('full resolution fallback');
		expect(f.pages()['course/unrelated.json']).toBeUndefined();
		await f.reference();
		f.git(f.course, 'rm', '-f', 'nested/target.md');
		await f.run();
		expect(f.pages()['course/nested/target.json']).toBeUndefined();
		await f.reference();
	} finally {
		f.cleanup();
	}
}, 20_000);

test('edition policies invalidate cached public bodies and cannot reuse full private output', async () => {
	const f = fixture();
	try {
		await f.run(true, false);
		await f.run(true, true);
		expect(await f.run(true, true)).toContain(
			'incremental resolution, 0 dirty bodies, 0 ASTs loaded'
		);
		f.write('publish.yaml', 'include:\n  - "**"\nexclude:\n  - target.md\n');
		expect(await f.run(true, true)).toContain('full resolution fallback');
		const locked = JSON.parse(f.pages()['course/target.json']);
		expect(locked.locked).toBe(true);
		expect(locked.html).toBe('');
		expect(locked.markdown).toBeUndefined();
		await f.reference(true);
		await f.run(true, false);
		await f.reference(false);
	} finally {
		f.cleanup();
	}
}, 20_000);

test('transclusion closure preserves nested/cyclic expansion order and leaves unrelated edits incremental', async () => {
	const f = fixture();
	try {
		f.write('source.md', '# Source\n\n![[target]]\n');
		f.write('target.md', '# Target\n\n![[third]]\n');
		f.write('third.md', '# Third\n\n![[fourth]]\n');
		f.write('fourth.md', '# Fourth\n\n![[fifth]]\n');
		f.write('fifth.md', '# Fifth\n\n![[source]]\n');
		f.git(f.course, 'add', '.');
		await f.run();
		f.write('unrelated.md', '# Unrelated\n\nOnly this note changes.\n');
		expect(await f.run()).toContain('incremental resolution, 1 dirty bodies, 1 ASTs loaded');
		await f.reference();
		f.write('fifth.md', '# Fifth\n\nNew embedded body. ![[source]]\n');
		expect(await f.run()).toContain('full resolution fallback');
		await f.reference();
	} finally {
		f.cleanup();
	}
}, 20_000);

test('portable compact cache restores into a fresh site and reconstructs corrupt final documents without loading ASTs', async () => {
	const f = fixture();
	try {
		f.write(
			'source.md',
			'---\naliases: [unused-alias]\n---\n# Source\n\n[[missing]]\n\n```unrecognized-fixture-language\nplain text\n```\n'
		);
		await f.run();
		const cache = path.join(f.site, 'build/generated/cache');
		const originalWarnings = readFileSync(
			path.join(f.site, 'build/generated/warnings.txt'),
			'utf8'
		);
		expect(await f.run()).toContain('incremental resolution, 0 dirty bodies, 0 ASTs loaded');
		expect(readFileSync(path.join(f.site, 'build/generated/warnings.txt'), 'utf8')).toBe(
			originalWarnings
		);
		const compactBytes = readFileSync(path.join(cache, 'content-current-full.json'), 'utf8');
		expect(compactBytes).not.toContain(f.root);
		const restored = path.join(f.root, 'restored');
		mkdirSync(restored);
		cpSync(cache, path.join(restored, 'build/generated/cache'), { recursive: true });
		expect(await f.run(true, false, restored)).toContain(
			'incremental resolution, 0 dirty bodies, 0 ASTs loaded'
		);
		expect(f.pages(restored)).toEqual(f.pages());
		const index = JSON.parse(compactBytes);
		writeFileSync(path.join(cache, index.pages['course/source.md'].document), '{}');
		expect(await f.run()).toContain('incremental resolution, 0 dirty bodies, 0 ASTs loaded');
		expect(f.pages()).toEqual(f.pages(restored));
		writeFileSync(path.join(cache, 'content-current-full.json'), '{}');
		expect(await f.run()).toContain('full resolution fallback');
		expect(f.pages()).toEqual(f.pages(restored));
	} finally {
		f.cleanup();
	}
}, 20_000);

test('HTML asset universe changes invalidate bodies and failed public validation preserves the last cache selection', async () => {
	const f = fixture();
	try {
		f.write('source.md', '# Source\n\n[[demo]]\n');
		f.write('demo.html', '<p>First demo</p>');
		f.git(f.course, 'add', '.');
		await f.run();
		f.write('demo.html', '<p>Updated demo bytes</p>');
		expect(await f.run()).toContain('incremental resolution, 0 dirty bodies, 0 ASTs loaded');
		expect(readFileSync(path.join(f.site, 'build/generated/assets/course/demo'), 'utf8')).toBe(
			'<p>Updated demo bytes</p>'
		);
		await f.reference();
		f.git(f.course, 'rm', '-f', 'demo.html');
		expect(await f.run()).toContain('full resolution fallback');
		await f.reference();
		await f.run(true, true);
		const selection = path.join(f.site, 'build/generated/cache/content-current-public.json');
		const previous = readFileSync(selection, 'utf8');
		f.write('publish.yaml', 'include:\n  - README.md\n  - source.md\n  - unrelated.md\n');
		f.write('source.md', '# Source\n\n![[target]]\n');
		await expect(f.run(true, true)).rejects.toThrow('transclusion requires explicit publication');
		expect(readFileSync(selection, 'utf8')).toBe(previous);
	} finally {
		f.cleanup();
	}
}, 20_000);
