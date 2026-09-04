export interface ParsedSearchQuery {
	/** `null` asks Pagefind for filter-only results. */
	term: string | null;
	/** Quartz-compatible leading `#tag` filter. */
	tag?: string;
}

/**
 * Quartz treated a leading `#tag` as a tag search. Preserve that shorthand
 * while still allowing free text after the tag (`#cs544 spark`).
 */
export function parseSearchQuery(value: string): ParsedSearchQuery {
	const query = value.trim();
	const tagged = /^#([^\s]+)(?:\s+([\s\S]*))?$/.exec(query);
	if (!tagged) return { term: query };

	const remainder = tagged[2]?.trim() ?? '';
	return {
		term: remainder === '' ? null : remainder,
		tag: tagged[1]
	};
}
