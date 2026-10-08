import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('search CLI builds from documents without prerender HTML and safely restores a complete index', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'wisconsin-search-cli-'));
	try {
		const pages = {
			index: { slug: 'index', title: 'Home', tags: [], html: '<h1>Home</h1>' },
			'course/note': {
				slug: 'course/note',
				title: 'Note',
				tags: ['topic'],
				html: '<h1 id="note">Note</h1><p>Needle</p>',
				dates: { modified: '' },
				description: ''
			},
			'course/locked': {
				slug: 'course/locked',
				title: 'Locked',
				locked: true,
				tags: [],
				html: '<p>Private secret</p>'
			}
		};
		const manifest = {
			pages,
			folders: ['course'],
			tags: { topic: ['course/note'] },
			tree: {
				name: 'wisconsin',
				slug: '',
				pages: [{ slug: 'index', title: 'Home' }],
				children: [
					{
						name: 'course',
						slug: 'course',
						children: [],
						pages: [
							{ slug: 'course/note', title: 'Note' },
							{ slug: 'course/locked', title: 'Locked' }
						]
					}
				]
			}
		};
		mkdirSync(path.join(root, 'build/generated/pages/course'), { recursive: true });
		mkdirSync(path.join(root, 'src/lib/generated'), { recursive: true });
		writeFileSync(
			path.join(root, 'build/generated/content-manifest.json'),
			JSON.stringify(manifest)
		);
		for (const [slug, page] of Object.entries(pages))
			writeFileSync(path.join(root, 'build/generated/pages', `${slug}.json`), JSON.stringify(page));
		writeFileSync(
			path.join(root, 'src/lib/generated/file-entries.json'),
			JSON.stringify([{ course: 'course', file: 'data.csv' }])
		);
		const output = path.join(root, 'destination');
		const run = () => {
			const child = spawnSync(
				'node',
				[fileURLToPath(new URL('../../tooling/search.js', import.meta.url)), output],
				{
					cwd: root,
					env: { ...process.env, VITE_PUBLIC_EDITION: 'true' },
					encoding: 'utf8',
					timeout: 15000
				}
			);
			if (child.error || child.status !== 0 || !child.stdout?.trim()) {
				throw new Error(
					`Native Pagefind CLI failed (status=${child.status}, signal=${child.signal}). ${child.error?.message || child.stderr || 'No result was returned; the sandbox may block native child-process IPC. Run this fixture with native subprocess permissions.'}`
				);
			}
			return child.stdout;
		};
		expect(run()).toContain('search: 5 pages + 1 file records');
		expect(run()).toContain('(complete index cached)');
		const cacheRoot = path.join(root, 'build/generated/cache');
		const files = JSON.parse(
			readFileSync(path.join(cacheRoot, 'search-current-public.json'), 'utf8')
		) as string[];
		expect(files.length).toBeGreaterThan(3);
		const entry = JSON.parse(
			readFileSync(path.join(output, 'pagefind/pagefind-entry.json'), 'utf8')
		);
		expect(entry.languages.en.page_count).toBe(6);
		const fragment = files.find((file) => file.includes('/fragment/'))!;
		writeFileSync(path.join(cacheRoot, fragment), 'corrupted');
		writeFileSync(path.join(output, 'pagefind/stale.pf_fragment'), 'obsolete');
		expect(run()).not.toContain('(complete index cached)');
		expect(() => readFileSync(path.join(output, 'pagefind/stale.pf_fragment'))).toThrow();
		expect(run()).toContain('(complete index cached)');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}, 20000);
