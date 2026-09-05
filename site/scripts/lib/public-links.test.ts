import { expect, test } from 'bun:test';
import type { Element, Root } from 'hast';
import { protectPublicLinks } from './public-links';

function tree(element: Partial<Element>): Root {
	return {
		type: 'root',
		children: [{ type: 'element', tagName: 'a', properties: {}, children: [], ...element }]
	};
}

test('public notes cannot embed or transclude unapproved content', () => {
	const allowed = new Set(['course/note', 'course/figure.png']);
	for (const element of [
		{ tagName: 'img', properties: { src: './slide.png' } },
		{ tagName: 'iframe', properties: { src: './exam.pdf' } },
		{ tagName: 'source', properties: { srcSet: './figure.png 1x, ./slide.png 2x' } },
		{
			tagName: 'blockquote',
			properties: { className: ['transclude'] },
			children: tree({ properties: { href: './secret' } }).children as Element[]
		}
	])
		expect(() => protectPublicLinks(tree(element), 'course/note', allowed)).toThrow();
	expect(() =>
		protectPublicLinks(
			tree({ tagName: 'img', properties: { src: './figure.png' } }),
			'course/note',
			allowed
		)
	).not.toThrow();
});

test('private links lose their destination and preview metadata without rewriting author text', () => {
	const content = tree({
		properties: { href: './secret', 'data-slug': 'course/secret', className: ['internal'] },
		children: [{ type: 'text', value: 'Restricted reference' }]
	});
	protectPublicLinks(content, 'course/note', new Set(['course/note']));
	expect(content.children[0]).toEqual({
		type: 'element',
		tagName: 'span',
		properties: {},
		children: [{ type: 'text', value: 'Restricted reference' }]
	});
});

test('same-origin absolute links are checked, external links and local anchors are preserved', () => {
	const allowed = new Set(['course/note']);
	for (const href of ['https://example.com/source', '#proof', '/course/note#proof']) {
		const content = tree({ properties: { href } });
		protectPublicLinks(content, 'course/note', allowed);
		expect((content.children[0] as Element).properties.href).toBe(href);
	}
	const content = tree({ properties: { href: 'https://wisconsin.twango.dev/course/secret' } });
	protectPublicLinks(content, 'course/note', allowed);
	expect((content.children[0] as Element).tagName).toBe('span');
});
