import { expect, test, spyOn } from 'bun:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import fsDefault from 'node:fs';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
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
	const run = async (
		incremental = true,
		publicEdition = false,
		destination = site,
		development = false
	) => {
		const logs: string[] = [];
		const log = spyOn(console, 'log').mockImplementation((value) => logs.push(String(value)));
		try {
			await compileContent({
				siteDir: destination,
				repoRoot: root,
				publicEdition,
				incremental,
				development
			});
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

test('validated compiler metadata avoids disk index reads, stays immutable and repairs cached products', async () => {
	const f = fixture();
	const options = { siteDir: f.site, repoRoot: f.root, publicEdition: false, development: true };
	try {
		const first = await compileContent(options);
		const originalIndex = JSON.stringify(first.index);
		const indexFile = path.join(f.site, 'build/generated/cache/content-current-full.json');
		const cache = path.dirname(indexFile);
		writeFileSync(indexFile, 'broken persisted index');
		f.write('source.md', '# Changed source\n\n[[target]]\n');
		const reading = spyOn(fs, 'readFileSync');
		let next;
		try {
			next = await compileContent({
				...options,
				previous: first,
				changedInputs: new Set([path.join(f.course, 'source.md')])
			});
			expect(reading.mock.calls.filter(([file]) => file === indexFile)).toHaveLength(0);
		} finally {
			reading.mockRestore();
		}
		expect(JSON.stringify(first.index)).toBe(originalIndex);
		expect(next.manifest.pages['course/source'].title).toBe('Changed source');
		expect(next.index.pages['course/unrelated.md'].summary).toBe(
			first.index.pages['course/unrelated.md'].summary
		);
		expect(JSON.parse(readFileSync(indexFile, 'utf8')).renderer).toBe(next.index.renderer);
		expect(Object.hasOwn(next.index.pages['course/source.md'].summary, 'tree')).toBe(false);
		expect(Object.hasOwn(next.index.pages['course/source.md'].summary, 'markdown')).toBe(false);
		const body = next.index.pages['course/target.md'].body!;
		writeFileSync(path.join(cache, body), 'broken resolved body');
		rmSync(path.join(f.site, 'build/generated/pages/course/target.json'));
		const repaired = await compileContent({ ...options, previous: next });
		expect(JSON.parse(f.pages()['course/target.json']).html).toContain('Target content');
		expect(readFileSync(path.join(cache, body), 'utf8')).not.toBe('broken resolved body');
		expect(repaired.manifest.generatedAt).toBe(next.manifest.generatedAt);
		// Production still reads and validates the on-disk index independently.
		const fresh = spyOn(fs, 'readFileSync');
		try {
			await compileContent({ ...options, previous: repaired, development: false });
			expect(fresh.mock.calls.some(([file]) => file === indexFile)).toBe(true);
		} finally {
			fresh.mockRestore();
		}
	} finally {
		f.cleanup();
	}
}, 20_000);

test('dev graph versions track graph dependencies rather than ordinary body metadata', async () => {
	const f = fixture();
	const options = { siteDir: f.site, repoRoot: f.root, publicEdition: false, development: true };
	const versionFile = path.join(f.site, 'src/lib/generated/graph-version.json');
	const version = () => readFileSync(versionFile, 'utf8');
	try {
		let previous = await compileContent(options);
		const initial = version();
		f.write('source.md', '# Source\n\nA longer body with the same links.\n\n[[target]]\n');
		previous = await compileContent({ ...options, previous });
		expect(version()).toBe(initial);
		f.write('source.md', '# New title\n\n[[target]]\n');
		previous = await compileContent({ ...options, previous });
		const renamed = version();
		expect(renamed).not.toBe(initial);
		f.write('source.md', '# New title\n\n[[unrelated]]\n');
		previous = await compileContent({ ...options, previous });
		const relinked = version();
		expect(relinked).not.toBe(renamed);
		rmSync(versionFile);
		await compileContent({ ...options, previous });
		expect(version()).toBe(relinked);
	} finally {
		f.cleanup();
	}
}, 20_000);

test('code, math, and diagram edits load only needed grammars and reuse the dev highlighter', () => {
	const f = fixture();
	try {
		const output = execFileSync(
			'bun',
			[
				'-e',
				`
import { strict as assert } from 'node:assert';
import { spyOn } from 'bun:test';
import * as fs from 'node:fs';
import path from 'node:path';
import * as shiki from ${JSON.stringify(import.meta.resolve('shiki'))};
import { compileContent } from ${JSON.stringify(path.resolve(import.meta.dirname, '../../tooling/compiler.ts'))};
const create = shiki.createHighlighter;
let calls = 0;
const instances = [];
spyOn(shiki, 'createHighlighter').mockImplementation((...args) => { calls++; const result = create(...args); void result.then(hl => instances.push(hl)); return result; });
const options = { siteDir: ${JSON.stringify(f.site)}, repoRoot: ${JSON.stringify(f.root)}, development: true };
await compileContent(options);
assert.equal(calls, 0);
const fence = String.fromCharCode(96).repeat(3);
const source = ${JSON.stringify(path.join(f.course, 'source.md'))};
fs.writeFileSync(source, '# Source\\n\\n$$x^2$$\\n\\n' + fence + 'mermaid\\ngraph TD\\nA-->B\\n' + fence + '\\n');
await compileContent(options);
assert.equal(calls, 0);
for (let i = 1; i <= 2; i++) {
  fs.writeFileSync(${JSON.stringify(path.join(f.course, 'source.md'))}, '# Source\\n\\n\`\`\`js\\nconsole.log(' + i + ');\\n\`\`\`\\n');
  await compileContent(options);
  assert.equal(calls, 1);
  const page = JSON.parse(fs.readFileSync(path.join(options.siteDir, 'build/generated/pages/course/source.json'), 'utf8'));
  assert(page.html.includes('shiki'));
  assert(page.html.includes(String(i)));
  assert(!instances[0].getLoadedLanguages().includes('r'));
}
fs.writeFileSync(source, '# Source\\n\\n' + fence + 'r\\nmean(c(1, 2))\\n' + fence + '\\n');
await compileContent(options);
assert.equal(calls, 1);
assert(instances[0].getLoadedLanguages().includes('r'));
assert(!instances[0].getLoadedLanguages().includes('java'));
fs.writeFileSync(source, '# Source\\n\\n' + fence + 'cpp-macro\\n#define ANSWER 42\\n' + fence + '\\n');
await compileContent(options);
assert(!fs.readFileSync(path.join(options.siteDir, 'build/generated/warnings.txt'), 'utf8').includes('shiki: unknown languages'));
fs.writeFileSync(source, '# Source\\n\\n' + fence + 'twiki-unrecognized\\nplain code\\n' + fence + '\\n');
await compileContent(options);
assert(fs.readFileSync(path.join(options.siteDir, 'build/generated/warnings.txt'), 'utf8').includes('twiki-unrecognized (1)'));
const production = path.join(${JSON.stringify(f.root)}, 'production');
fs.mkdirSync(production);
await compileContent({ ...options, siteDir: production, development: false });
assert.equal(calls, 2);
console.log('highlighter lifecycle passed');
`
			],
			{ encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 20_000 }
		);
		expect(output).toContain('highlighter lifecycle passed');
	} finally {
		f.cleanup();
	}
}, 25_000);

test('development size checks reject assets that outgrow a previously validated copy', async () => {
	const f = fixture();
	try {
		f.write('image.svg', '<svg/>');
		f.git(f.course, 'add', 'image.svg');
		const run = () => compileContent({ siteDir: f.site, repoRoot: f.root, development: true });
		await run();
		await run();
		writeFileSync(path.join(f.course, 'image.svg'), Buffer.alloc(25 * 1024 * 1024 + 1, 32));
		await expect(run()).rejects.toThrow('Content exceeds the deployment asset limit');
	} finally {
		f.cleanup();
	}
});

test('compiler discovery excludes linked notes and assets while retaining ordinary sources', async () => {
	const f = fixture();
	try {
		const outside = path.join(f.root, 'private.md');
		writeFileSync(outside, '# Outside vault secret');
		symlinkSync(outside, path.join(f.course, 'linked.md'));
		symlinkSync(outside, path.join(f.course, 'linked.svg'));
		f.git(f.course, 'add', 'linked.md', 'linked.svg');
		await f.run();
		expect(f.pages()['course/source.json']).toBeDefined();
		expect(f.pages()['course/linked.json']).toBeUndefined();
		expect(existsSync(path.join(f.site, 'build/generated/assets/course/linked.svg'))).toBe(false);
		expect(JSON.stringify(f.pages())).not.toContain('Outside vault secret');
	} finally {
		f.cleanup();
	}
});

test('an explicit asset change reads fresh bytes even when filesystem identities collide', async () => {
	const f = fixture();
	try {
		f.write('image.svg', '<svg>before</svg>');
		f.git(f.course, 'add', 'image.svg');
		const source = path.join(f.course, 'image.svg');
		const destination = path.join(f.site, 'build/generated/assets/course/image.svg');
		await f.run(true, false, f.site, true);
		const originalStat = fs.statSync;
		const observed = originalStat(source, { bigint: true });
		f.write('image.svg', '<svg>after!</svg>');
		const stats = spyOn(fs, 'statSync').mockImplementation(((
			...args: Parameters<typeof originalStat>
		) => {
			if (String(args[0]) === source && args[1]?.bigint) return observed;
			return originalStat(...args);
		}) as typeof originalStat);
		try {
			await compileContent({
				siteDir: f.site,
				repoRoot: f.root,
				publicEdition: false,
				development: true,
				changedInputs: new Set([source])
			});
			expect(readFileSync(destination, 'utf8')).toBe('<svg>after!</svg>');
		} finally {
			stats.mockRestore();
		}
	} finally {
		f.cleanup();
	}
});

test('Markdown edits avoid rereading unchanged assets in development and still publish asset edits', async () => {
	const f = fixture();
	let restore: (() => void) | undefined;
	try {
		f.write('image.svg', '<svg>before</svg>');
		f.git(f.course, 'add', 'image.svg');
		const source = path.join(f.course, 'image.svg');
		const output = path.join(f.site, 'build/generated/assets/course/image.svg');
		const run = () => compileContent({ siteDir: f.site, repoRoot: f.root, development: true });
		await run();
		const cache = path.join(f.site, 'build/generated/cache');
		const index = JSON.parse(readFileSync(path.join(cache, 'content-current-full.json'), 'utf8'));
		const unchangedDocument = path.join(cache, index.pages['course/unrelated.md'].document);
		const unchangedBody = path.join(cache, index.pages['course/unrelated.md'].body);
		await run();
		const unchangedOutput = path.join(f.site, 'build/generated/pages/course/unrelated.json');
		const read = spyOn(fs, 'readFileSync');
		const mkdir = spyOn(fs, 'mkdirSync');
		restore = () => {
			read.mockRestore();
			mkdir.mockRestore();
		};
		// Installing a reader spy changes its identity; prime copies with that reader first.
		await run();
		read.mockClear();
		mkdir.mockClear();
		f.write('source.md', '# Source\n\nA Markdown-only edit.\n');
		await run();
		expect(read.mock.calls.filter(([file]) => file === source || file === output)).toHaveLength(0);
		expect(
			read.mock.calls.filter(
				([file]) => file === unchangedDocument || file === unchangedOutput || file === unchangedBody
			)
		).toHaveLength(0);
		expect(
			mkdir.mock.calls.filter(([directory]) => directory === path.dirname(output))
		).toHaveLength(0);
		read.mockRestore();
		mkdir.mockRestore();
		restore = undefined;
		f.write('image.svg', '<svg>after!</svg>');
		await run();
		expect(readFileSync(output, 'utf8')).toBe('<svg>after!</svg>');
		const expected = readFileSync(unchangedOutput, 'utf8');
		writeFileSync(unchangedBody, '{}');
		await run();
		expect(readFileSync(unchangedOutput, 'utf8')).toBe(expected);
		expect(JSON.parse(readFileSync(unchangedBody, 'utf8')).html).toContain('Unchanged content');
	} finally {
		restore?.();
		f.cleanup();
	}
});

test('ordinary dev edits skip unchanged source reads and match a fresh production compile', async () => {
	const f = fixture();
	try {
		await f.run(true, false, f.site, true);
		f.write('source.md', '# Source\n\n[[target]]\n\nOrdinary body edit.\n');
		const source = path.join(f.course, 'source.md');
		const unrelated = path.join(f.course, 'unrelated.md');
		const read = spyOn(fsDefault, 'readFileSync');
		try {
			await f.run(true, false, f.site, true);
			expect(read.mock.calls.filter(([file]) => String(file) === unrelated)).toHaveLength(0);
			expect(read.mock.calls.filter(([file]) => String(file) === source)).toHaveLength(1);
		} finally {
			read.mockRestore();
		}
		await f.reference();
	} finally {
		f.cleanup();
	}
}, 20_000);

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
