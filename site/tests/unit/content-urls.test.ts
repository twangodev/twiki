import { expect, test } from 'bun:test';
import type { Element, Root } from 'hast';
import { absolutizeUrls } from '../../tooling/lib/content-urls';
import type { FullSlug } from '../../tooling/lib/slug';

const assets = new Map([
	['/course/assets/fossil', '/course/assets/fossil.html'],
	['/course/demo', '/course/demo/index.html'],
	['/course/assets/café', '/course/assets/café.html']
]);

function resolve(value: string, attribute = 'href', slug = 'course/labs/lab-11') {
	const node: Element = {
		type: 'element',
		tagName: 'a',
		properties: { [attribute]: value },
		children: []
	};
	const tree: Root = { type: 'root', children: [node] };
	absolutizeUrls(tree, slug as FullSlug, assets);
	return node.properties[attribute];
}

test('HTML assets use their static filenames, preserving queries and fragments', () => {
	expect(resolve('../assets/fossil?view=1#details')).toBe(
		'/course/assets/fossil.html?view=1#details'
	);
	expect(resolve('/course/assets/fossil', 'src')).toBe('/course/assets/fossil.html');
	expect(resolve('../demo/')).toBe('/course/demo/index.html');
	expect(resolve('../assets/caf%C3%A9')).toBe('/course/assets/caf%C3%A9.html');
	expect(resolve('../assets/fossil.html')).toBe('/course/assets/fossil.html');
});

test('ordinary pages, missing targets and non-HTML assets keep their routes', () => {
	expect(resolve('../lecture?mode=print#notes')).toBe('/course/lecture?mode=print#notes');
	expect(resolve('../missing')).toBe('/course/missing');
	expect(resolve('../assets/image.png', 'src')).toBe('/course/assets/image.png');
	expect(resolve('../../course/lecture', 'href', 'course/labs/index')).toBe('/course/lecture');
});

test('external URLs and same-page anchors are preserved', () => {
	for (const value of [
		'https://other.test/course/assets/fossil',
		'//other.test/image.png',
		'#heading',
		'mailto:a@example.com',
		'data:image/png;base64,abc'
	])
		expect(resolve(value)).toBe(value);
});
