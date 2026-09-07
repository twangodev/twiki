import { expect, test } from 'bun:test';
import { textExportUrl } from '../../src/lib/text-exports';

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
