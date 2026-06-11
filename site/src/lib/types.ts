/**
 * Minimal shared types for the doc shell. The content manifest (prebuild,
 * Phase 1+) is expected to provide data in these shapes.
 */

/** A node in the sidebar navigation tree (Explorer). */
export interface NavNode {
	title: string;
	/** Route if this node is itself a page (folder landing pages, or leaf docs). No trailing slash. */
	route?: string;
	/** Child nodes (sections and pages), already naturally sorted. */
	children: NavNode[];
	/** Segment key used for sorting/keying within its parent. */
	segment: string;
}

/** A flat table-of-contents entry for the right-hand rail. */
export interface TocEntry {
	id: string;
	text: string;
	/** Heading level (2–4). */
	level: number;
}

/** Per-page metadata from the content manifest. */
export interface PageMeta {
	/** Canonical slug, e.g. `sp26-cs537/README` (no leading slash). */
	slug: string;
	title: string;
	description?: string;
	tags: string[];
	/** Last-modified epoch millis (frontmatter date → git → fs). */
	modified?: number;
	/** Reading time in minutes. */
	readingTime?: number;
}
