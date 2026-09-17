import { expect, test } from 'bun:test';
import { buildRmdPreviews } from '../../tooling/lib/rmd-previews';
import type { CourseFile } from '../../src/lib/files';

test('missing R permits dev startup but still blocks production previews', async () => {
	const previous = process.env.RSCRIPT;
	process.env.RSCRIPT = '/nonexistent-wisconsin-test-Rscript';
	const files: CourseFile[] = [
		{
			path: 'worksheet.Rmd',
			kind: 'text',
			size: 10,
			download: '/_files/blobs/source.bin',
			rmdPreview: '/stale-preview.json'
		}
	];
	const retain = () => {
		throw new Error('Must not emit without R');
	};
	try {
		await buildRmdPreviews('/unused', 'test', files, '/unused', retain, true);
		expect(files[0].rmdPreview).toBeUndefined();
		await expect(buildRmdPreviews('/unused', 'test', files, '/unused', retain)).rejects.toThrow(
			'R Markdown previews require R and knitr'
		);
	} finally {
		if (previous === undefined) delete process.env.RSCRIPT;
		else process.env.RSCRIPT = previous;
	}
});
