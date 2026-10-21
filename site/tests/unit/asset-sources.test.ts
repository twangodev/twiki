import { expect, test } from 'bun:test';
import path from 'node:path';
import { assetSources } from '../../tooling/lib/asset-sources';

test('asset sources follow emitted selections, deduplicate aliases and reserve course files', () => {
	const assets = path.resolve('/tmp/edition/assets');
	const files = path.join(assets, '_files');
	expect(
		assetSources(
			assets,
			['image.svg', 'slides', 'image.svg', 'secret-1.svg', '_files/private.svg'],
			files,
			[path.join(files, 'index/course.json'), path.join(files, 'icons/LICENSE.txt')]
		)
	).toEqual([
		{ src: path.join(assets, 'image.svg'), rel: 'image.svg' },
		{ src: path.join(assets, 'slides'), rel: 'slides' },
		{ src: path.join(assets, 'secret-1.svg'), rel: 'secret-1.svg' },
		{ src: path.join(files, 'index/course.json'), rel: path.join('_files', 'index/course.json') },
		{ src: path.join(files, 'icons/LICENSE.txt'), rel: path.join('_files', 'icons/LICENSE.txt') }
	]);
});

test('asset sync refuses traversal and course outputs from another edition', () => {
	const assets = path.resolve('/tmp/edition/public-assets');
	const files = path.resolve('/tmp/edition/public-files');
	for (const relative of [
		'../private.svg',
		'/private.svg',
		'a/../../private.svg',
		'a\\private.svg'
	])
		expect(() => assetSources(assets, [relative], files, [])).toThrow('Unsafe compiled asset path');
	expect(() =>
		assetSources(assets, [], files, [path.resolve('/tmp/edition/assets/_files/private.bin')])
	).toThrow('outside its edition');
});
