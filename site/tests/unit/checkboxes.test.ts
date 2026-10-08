import { expect, test } from 'bun:test';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import { visit } from 'unist-util-visit';
import type { Element, Root } from 'hast';
import { ofmCallouts, ofmCheckboxes, ofmTextTransform } from '../../tooling/lib/ofm';

test('cached notes and collapsed answers enable task choices without changing checked state', async () => {
	const source = ofmTextTransform(`- [ ] An unanswered choice
- [x] An existing checked task

> [!success]- Answer
> - [ ] A choice inside a collapsed answer

<input type="text" disabled value="read only">
`);
	const processor = unified()
		.use(remarkParse)
		.use(remarkGfm)
		.use(() => ofmCallouts())
		.use(remarkRehype, { allowDangerousHtml: true })
		.use(rehypeRaw);
	const parsed = await processor.run(processor.parse(source));
	const tree = JSON.parse(JSON.stringify(parsed)) as Root;
	ofmCheckboxes()(tree);
	const inputs: Element[] = [];
	visit(tree, 'element', (node: Element) => {
		if (node.tagName === 'input') inputs.push(node);
	});
	const checkboxes = inputs.filter((node) => node.properties.type === 'checkbox');
	expect(checkboxes).toHaveLength(3);
	expect(checkboxes.map((node) => Boolean(node.properties.checked))).toEqual([false, true, false]);
	for (const node of checkboxes) expect(node.properties.disabled).toBeUndefined();
	expect(inputs.find((node) => node.properties.type === 'text')?.properties.disabled).toBe(true);
});
