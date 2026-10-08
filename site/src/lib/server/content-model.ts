import type {
	ContentManifest,
	FolderEntry,
	FolderListing,
	ManifestPage,
	NavNode,
	TreeNode
} from '../types';
import { site } from '../config';

export function createContentModel(manifest: ContentManifest) {
	const getManifest = () => manifest;
	/**
	 * Canonical slug → display route (no leading/trailing slash; `''` = home).
	 * Trailing `index` segments are trimmed from URLs.
	 */
	function displayRoute(slug: string): string {
		if (slug === 'index') return '';
		if (slug.endsWith('/index')) return slug.slice(0, -'/index'.length);
		return slug;
	}

	/** Display route → canonical page slug, or undefined if no page lives there. */
	function pageSlugForRoute(route: string): string | undefined {
		const { pages } = getManifest();
		if (route === '') return Object.hasOwn(pages, 'index') ? 'index' : undefined;
		if (Object.hasOwn(pages, route) && !route.endsWith('/index')) return route;
		if (Object.hasOwn(pages, `${route}/index`)) return `${route}/index`;
		// A literal `…/index` URL is not canonical (the live site never emits it).
		return undefined;
	}

	/** Folders that have no index page and therefore get a generated listing. */
	function listingFolders(): string[] {
		const m = getManifest();
		return m.folders.filter(
			(f) => !Object.hasOwn(m.pages, `${f}/index`) && !Object.hasOwn(m.pages, f)
		);
	}

	/**
	 * Every route served by the catch-all `[...slug]` page route:
	 * all page display routes (including `''` = home) + generated folder listings.
	 * Tag routes live under `src/routes/tags/` and are not included here.
	 */
	function contentEntries(): string[] {
		const m = getManifest();
		const routes = Object.keys(m.pages).map(displayRoute);
		return [...new Set(['', ...routes, ...listingFolders()])];
	}

	/** Natural sort, Quartz Explorer-style (numeric, case-insensitive). */
	const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

	function findTreeNode(folder: string): TreeNode | undefined {
		let node: TreeNode | undefined = getManifest().tree;
		if (folder === '') return node;
		for (const segment of folder.split('/')) {
			node = node?.children.find((c) => c.name === segment);
			if (!node) return undefined;
		}
		return node;
	}

	function toNavNode(node: TreeNode): NavNode {
		const indexSlug = `${node.slug}/index`;
		const folders = node.children.map(toNavNode).sort((a, b) => collator.compare(a.title, b.title));
		const pages = node.pages
			.filter((p) => p.slug !== indexSlug)
			.map(
				(p): NavNode => ({
					locked: getManifest().pages[p.slug]?.locked,
					title: p.title,
					route: `/${displayRoute(p.slug)}`,
					children: [],
					segment: p.slug.split('/').pop() ?? p.slug
				})
			)
			.sort((a, b) => collator.compare(a.title, b.title));
		return {
			locked: getManifest().pages[indexSlug]?.locked,
			// Explorer shows folder names (matching the live Quartz explorer), not
			// index-page titles — those can be long ("Midterm 1 - Practice Questions").
			title: node.name,
			route: `/${node.slug}`, // every folder has a route: index page or listing
			children: [...folders, ...pages],
			segment: node.name
		};
	}

	let navCache: NavNode[] | undefined;

	/** Sidebar Explorer tree: course folders first, then root pages (minus home). */
	function navTree(): NavNode[] {
		if (navCache) return navCache;
		const root = getManifest().tree;
		const folders = root.children.map(toNavNode).sort((a, b) => collator.compare(a.title, b.title));
		const rootPages = root.pages
			.filter((p) => p.slug !== 'index')
			.map(
				(p): NavNode => ({
					title: p.title,
					route: `/${displayRoute(p.slug)}`,
					children: [],
					segment: p.slug
				})
			)
			.sort((a, b) => collator.compare(a.title, b.title));
		navCache = [...folders, ...rootPages];
		return navCache;
	}

	function countPages(node: TreeNode): number {
		return node.pages.length + node.children.reduce((n, c) => n + countPages(c), 0);
	}

	/** Listing data for a folder without its own index page. */
	function folderListing(folder: string): FolderListing | undefined {
		const m = getManifest();
		if (folder !== '' && !m.folders.includes(folder)) return undefined;
		const node = findTreeNode(folder);
		if (!node) return undefined;
		const subfolders: FolderEntry[] = node.children
			.map((c) => ({ title: c.name, route: `/${c.slug}`, isFolder: true }))
			.sort((a, b) => collator.compare(a.title, b.title));
		const pages: FolderEntry[] = node.pages
			.filter((p) => p.slug !== `${folder}/index`)
			.map((p) => ({
				title: p.title,
				route: `/${displayRoute(p.slug)}`,
				isFolder: false,
				modified: m.pages[p.slug]?.dates.modified
			}))
			// Quartz folder pages list by date (newest first), then alphabetical.
			.sort(
				(a, b) =>
					Date.parse(b.modified ?? '0') - Date.parse(a.modified ?? '0') ||
					collator.compare(a.title, b.title)
			);
		return {
			folder,
			name: folder === '' ? site.name : (folder.split('/').pop() ?? folder),
			entries: [
				...subfolders,
				...pages,
				...(m.fileCourses?.includes(folder)
					? [{ title: 'Files', route: `/${folder}/files`, isFolder: true }]
					: [])
			],
			pageCount: countPages(node)
		};
	}

	/** All tags (case-sensitive) with page counts, alphabetical. */
	function tagIndex(): { tag: string; count: number }[] {
		const { tags } = getManifest();
		return Object.keys(tags)
			.sort((a, b) => collator.compare(a, b))
			.map((tag) => ({ tag, count: tags[tag].length }));
	}

	/** Pages for one tag (case-sensitive), newest first. */
	function tagPages(tag: string): ManifestPage[] | undefined {
		const m = getManifest();
		const slugs = m.tags[tag];
		if (!slugs) return undefined;
		return slugs
			.map((s) => m.pages[s])
			.filter((p): p is ManifestPage => !!p)
			.sort(
				(a, b) =>
					Date.parse(b.dates.modified) - Date.parse(a.dates.modified) ||
					collator.compare(a.title, b.title)
			);
	}

	function escapeXml(s: string): string {
		return s
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;');
	}

	function absoluteUrl(route: string): string {
		return route === '' ? `${site.url}/` : `${site.url}/${route}`;
	}

	/** RSS feed matching the live `/index.xml` shape: latest 10 by modified date. */
	function rssXml(): string {
		const m = getManifest();
		const items = Object.values(m.pages)
			.filter((page) => !page.locked)
			.sort((a, b) => Date.parse(b.dates.modified) - Date.parse(a.dates.modified))
			.slice(0, 10)
			.map((p) => {
				const url = absoluteUrl(displayRoute(p.slug));
				const description = p.description.replaceAll(']]>', ']]&gt;');
				return `<item>
    <title>${escapeXml(p.title)}</title>
    <link>${url}</link>
    <guid>${url}</guid>
    <description><![CDATA[ ${description} ]]></description>
    ${p.dates.published || p.dates.modified ? `<pubDate>${new Date(p.dates.published || p.dates.modified).toUTCString()}</pubDate>` : ''}
  </item>`;
			})
			.join('');
		return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
    <channel>
      <title>${escapeXml(site.title)}</title>
      <link>${site.url}</link>
      <description>Last 10 notes on ${escapeXml(site.title)}</description>
      <generator>${site.url}</generator>
      ${items}
    </channel>
  </rss>`;
	}

	/** Sitemap matching the live `/sitemap.xml` shape: every page, ISO lastmod. */
	function sitemapXml(): string {
		const m = getManifest();
		const urls = Object.values(m.pages)
			.filter((page) => !page.locked)
			.map(
				(p) => `<url>
    <loc>${escapeXml(absoluteUrl(displayRoute(p.slug)))}</loc>
    ${p.dates.modified ? `<lastmod>${p.dates.modified}</lastmod>` : ''}
  </url>`
			)
			.join('');
		const folders = m.fileCourses
			? contentEntries()
					.filter((route) => !pageSlugForRoute(route))
					.map((route) => `<url><loc>${escapeXml(absoluteUrl(route))}</loc></url>`)
					.join('')
			: '';
		return `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}${folders}</urlset>`;
	}

	return {
		displayRoute,
		pageSlugForRoute,
		listingFolders,
		contentEntries,
		navTree,
		folderListing,
		tagIndex,
		tagPages,
		rssXml,
		sitemapXml
	};
}
