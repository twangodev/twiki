/**
 * Shared types for the doc shell and the prebuild content manifest
 * (`site/.generated`, emitted by `scripts/build-content.ts`).
 */

/** A node in the sidebar navigation tree (Explorer). */
export interface NavNode {
	title: string;
	/** Route if this node is itself a page (folder landing pages, or leaf docs). No trailing slash. */
	route?: string;
	/** Child nodes (sections and pages), already naturally sorted (folders first). */
	children: NavNode[];
	/** Segment key used for sorting/keying within its parent. */
	segment: string;
}

/** A flat table-of-contents entry for the right-hand rail. */
export interface TocEntry {
	id: string;
	text: string;
	/** Heading level (1–6); h1 = 1. */
	level: number;
}

/** Raw TOC entry as emitted by the prebuild (`pages/<slug>.json`). */
export interface RawTocEntry {
	/** 0-based depth: 0 = h1. */
	depth: number;
	text: string;
	/** github-slugger anchor id. */
	slug: string;
}

/** Page dates from the prebuild (frontmatter → submodule git log → fs). */
export interface PageDates {
	created: string;
	modified: string;
	published: string;
}

/**
 * A backlink reference. `slug` is in display form: folder index pages end in
 * `/` (e.g. `sp26-cs537/exams/midterm-2/`), the homepage is `/`.
 */
export interface BacklinkRef {
	slug: string;
	title: string;
}

export interface PagePublication {
	public: boolean;
	reason?: string;
}

/** Per-page metadata as stored in `content-manifest.json` `pages`. */
export interface ManifestPage {
	publication: PagePublication;
	/** Canonical slug, e.g. `sp26-cs537/README` or `…/midterm-1/index` (no leading slash). */
	slug: string;
	title: string;
	description: string;
	tags: string[];
	dates: PageDates;
	/** Resolved outgoing link slugs (simple form). */
	links: string[];
	/** Backlink slugs (manifest stores display-form strings). */
	backlinks: string[];
	wordCount: number;
	readingTime: number;
	hasMermaid: boolean;
	relativePath: string;
}

/** Full page document (`pages/<slug>.json`): manifest meta + rendered HTML. */
export interface PageDoc extends Omit<ManifestPage, 'backlinks'> {
	backlinks: BacklinkRef[];
	toc: RawTocEntry[];
	html: string;
}

/** A folder-tree node from `content-manifest.json` `tree`. */
export interface TreeNode {
	/** Last path segment (`midterm-1`); root is the site name. */
	name: string;
	/** Full folder slug (`sp26-cs537/exams/midterm-1`); root is ``. */
	slug: string;
	/** Index-page title when the folder has an `index.md`, else the name. */
	title: string;
	children: TreeNode[];
	pages: { slug: string; title: string }[];
}

/** The global content manifest. */
export interface ContentManifest {
	fileCourses?: string[];
	generatedAt: string;
	counts: Record<string, number>;
	pages: Record<string, ManifestPage>;
	/** Every directory slug (with or without its own index page). */
	folders: string[];
	/** Tag → page slugs (case-sensitive tag keys). */
	tags: Record<string, string[]>;
	tree: TreeNode;
	/** Asset paths (slugified, extensionful) copied to static output. */
	assets: string[];
	/** Standalone .html assets, stored extensionless (served via html_handling). */
	htmlAssets: string[];
	graph: {
		nodes: { id: string; title: string; tags: string[] }[];
		links: { source: string; target: string }[];
	};
}

/** One entry in a generated folder-listing page. */
export interface FolderEntry {
	title: string;
	route: string;
	isFolder: boolean;
	/** ISO modified date (pages only). */
	modified?: string;
}

/** Data for a generated folder-listing page (folders without index.md). */
export interface FolderListing {
	/** Folder slug, e.g. `sp26-cs537/p1`. */
	folder: string;
	/** Display name (last segment). */
	name: string;
	entries: FolderEntry[];
	/** Total pages anywhere under this folder. */
	pageCount: number;
}
