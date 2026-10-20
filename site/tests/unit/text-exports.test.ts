import { expect, test, spyOn } from 'bun:test';
import { textExportUrl } from '../../src/lib/text-exports';

import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { writeTextExports } from '../../tooling/lib/text-exports';
import { pruneOutputs } from '../../tooling/lib/output';

test('text extensions append to canonical note URLs', () => {
	expect(textExportUrl('course/lectures/lecture-01')).toBe('/course/lectures/lecture-01.md');
	expect(textExportUrl('course/lectures/lecture-01', 'txt')).toBe(
		'/course/lectures/lecture-01.txt'
	);
	expect(textExportUrl('course/exams/index')).toBe('/course/exams.md');
	expect(textExportUrl('course/README', 'txt')).toBe('/course/README.txt');
	expect(textExportUrl('course/a b')).toBe('/course/a%20b.md');
	expect(textExportUrl('index')).toBe('/index.md');
});

test('text exports reuse unchanged documents and repair edits, corruption and deletion', () => {
	const root = fs.mkdtempSync(path.join(tmpdir(), 'twiki-text-exports-'));
	const output = path.join(root, 'static');
	const documents = path.join(root, 'pages');
	const document = path.join(documents, 'note.json');
	const page = { slug: 'note', title: 'Original title' };
	const pages = [page, { slug: 'restricted', title: 'Restricted', locked: true }];
	const emit = () => writeTextExports(output, documents, pages, new Set(), true);
	try {
		fs.mkdirSync(documents);
		fs.writeFileSync(document, JSON.stringify({ ...page, markdown: '[[original]]', html: '' }));
		const written = emit();
		expect([...written].sort()).toEqual(['llms.txt', 'note.md', 'note.txt']);
		const markdown = path.join(output, 'note.md');
		const text = path.join(output, 'note.txt');
		const original = fs.readFileSync(markdown, 'utf8');
		expect(original).toContain('[[original]]');
		expect(fs.readFileSync(text, 'utf8')).toBe(original);
		expect(fs.readFileSync(path.join(output, 'llms.txt'), 'utf8')).not.toContain('[Restricted]');
		const read = spyOn(fs, 'readFileSync');
		try {
			emit();
			expect(
				read.mock.calls.filter(([file]) => [document, markdown, text].includes(String(file)))
			).toHaveLength(0);
		} finally {
			read.mockRestore();
		}
		const stamp = fs.statSync(markdown);
		fs.writeFileSync(markdown, original.replace('original', 'modified'));
		fs.utimesSync(markdown, stamp.atime, stamp.mtime);
		fs.rmSync(text);
		emit();
		expect(fs.readFileSync(markdown, 'utf8')).toBe(original);
		expect(fs.readFileSync(text, 'utf8')).toBe(original);
		const sourceStamp = fs.statSync(document);
		fs.writeFileSync(document, JSON.stringify({ ...page, markdown: '[[modified]]', html: '' }));
		fs.utimesSync(document, sourceStamp.atime, sourceStamp.mtime);
		emit();
		expect(fs.readFileSync(text, 'utf8')).toContain('[[modified]]');
		expect(() => writeTextExports(output, documents, pages, new Set(['note.md']), true)).toThrow(
			'conflicts'
		);
		expect(() => writeTextExports(output, documents, [], new Set(['llms.txt']), true)).toThrow(
			'conflicts'
		);
		const locked = writeTextExports(
			output,
			documents,
			[{ ...page, locked: true }],
			new Set(),
			true
		);
		pruneOutputs(output, new Set([...locked].map((file) => path.join(output, file))));
		expect(fs.existsSync(markdown)).toBe(false);
		expect(fs.existsSync(text)).toBe(false);
		expect(fs.readFileSync(path.join(output, 'llms.txt'), 'utf8')).not.toContain(page.title);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
