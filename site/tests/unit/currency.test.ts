import { expect, test } from 'bun:test';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import { toString } from 'hast-util-to-string';
import type { Root } from 'hast';
import { preserveCurrency } from '../../tooling/lib/currency';

async function render(source: string) {
	const processor = unified()
		.use(remarkParse)
		.use(remarkMath)
		.use(() => preserveCurrency(source))
		.use(remarkRehype)
		.use(rehypeKatex);
	return (await processor.run(processor.parse(source))) as Root;
}

test('unescaped currency preserves literal amounts and prose instead of rendering as math', async () => {
	for (const prose of [
		'Prices: $186 billion, $1,000, $0.08, $0.06 and $0.01.',
		'From $5–$10.',
		'$0.08 in 2015, $0.06 in 2018, and $0.01 in May 2023.',
		'Renting one VM costs about $25, but renting many briefly also costs about $25.'
	]) {
		const tree = await render(prose);
		expect(toString(tree)).toBe(prose);
		expect(JSON.stringify(tree)).not.toContain('katex');
	}
});

test('escaped prices render exactly with spaces and all five dollar signs', async () => {
	const prose = 'Prices: $186 billion, $1,000, $0.08, $0.06 and $0.01.';
	const tree = await render(prose.replaceAll('$', '\\$'));
	expect(toString(tree)).toBe(prose);
	expect(JSON.stringify(tree)).not.toContain('katex');
});

test('math still renders alongside currency', async () => {
	const tree = await render(String.raw`Costs \$5 and \$10; compute $2 + 3$.`);
	expect(toString(tree)).toContain('Costs $5 and $10; compute');
	expect(JSON.stringify(tree)).toContain('katex');
});

test('code and ordinary math retain their meanings', async () => {
	const tree = await render('`$5 and $10` plus $2 + 3$.');
	expect(toString(tree)).toContain('$5 and $10');
	expect(JSON.stringify(tree)).toContain('katex');
});
