import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';

/** Obsidian comments apply to prose, never fenced or inline code (notably Mermaid %%). */
export function stripObsidianComments(source: string, preservePositions = false): string {
	if (!source.includes('%%')) return source;
	const protectedRanges: { start: number; end: number }[] = [];
	visit(unified().use(remarkParse).parse(source), (node) => {
		if (node.type === 'code' || node.type === 'inlineCode') {
			const start = node.position?.start.offset;
			const end = node.position?.end.offset;
			if (start !== undefined && end !== undefined) protectedRanges.push({ start, end });
		}
	});
	const pattern = /%%[\s\S]*?%%/g;
	let result = '',
		cursor = 0;
	for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
		const protectedRange = protectedRanges.find(
			(range) => match!.index >= range.start && match!.index < range.end
		);
		if (protectedRange) {
			pattern.lastIndex = protectedRange.end;
			continue;
		}
		result += source.slice(cursor, match.index);
		if (preservePositions) result += match[0].replace(/[^\r\n]/g, ' ');
		cursor = pattern.lastIndex;
	}
	return result + source.slice(cursor);
}
