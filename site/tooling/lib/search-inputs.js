/** Lightweight equivalents of the searchable content in the document routes.
 * The application shell, controls, backlinks and ignored metadata are not search
 * content. Keep HTML rather than custom records so Pagefind retains heading
 * anchors, HTML tokenization and excerpt semantics.
 */

/** @param {string} value */
export function escapeSearchHtml(value) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/** @param {string} slug */
function displayRoute(slug) {
	return slug === 'index' ? '' : slug.endsWith('/index') ? slug.slice(0, -6) : slug;
}

/** @param {string} title @param {string} body */
function document(title, body) {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeSearchHtml(title)}</title></head><body><article data-pagefind-body>${body}</article></body></html>`;
}

/** @param {string} course */
function courseFilter(course) {
	return `<span data-pagefind-ignore data-pagefind-filter="course">${escapeSearchHtml(course)}</span>`;
}

/** Match the article in [...slug]/+page.svelte, including its leading-H1 fallback.
 * @param {import('../../src/lib/types').PageDoc} page
 */
export function noteSearchInput(page) {
	if (page.locked) return;
	const route = displayRoute(page.slug);
	const heading = page.html.match(/^\s*<h1\b[^>]*>[\s\S]*?<\/h1>/i)?.[0];
	const metadata = route
		? `<div data-pagefind-ignore>${courseFilter(route.split('/')[0])}${page.tags.map((tag) => `<span data-pagefind-filter="tag">${escapeSearchHtml(tag)}</span>`).join('')}</div><span data-pagefind-meta="title">${escapeSearchHtml(page.title)}</span>`
		: '';
	return {
		url: `/${route}`,
		content: document(
			page.title,
			`${metadata}${heading ? page.html : `<h1>${escapeSearchHtml(page.title)}</h1>${page.html}`}`
		)
	};
}

/** @param {import('../../src/lib/types').ContentManifest} manifest
 * @param {(slug: string) => import('../../src/lib/types').PageDoc} loadPage
 * @returns {import('pagefind').HTMLFile[]}
 */
export function searchHtmlInputs(manifest, loadPage) {
	/** @type {import('pagefind').HTMLFile[]} */
	const inputs = [];
	const routes = new Set();
	for (const slug of Object.keys(manifest.pages)) {
		const route = displayRoute(slug);
		// The route loader prefers an exact page over a colliding folder index.
		if (routes.has(route) || (slug.endsWith('/index') && manifest.pages[route])) continue;
		routes.add(route);
		const input = noteSearchInput(loadPage(slug));
		if (input) inputs.push(input);
	}
	/** @type {Map<string, {name: string; count: number}>} */
	const folders = new Map();
	/** @param {import('../../src/lib/types').TreeNode} node @returns {number} */
	function visit(node) {
		const count = node.pages.length + node.children.reduce((sum, child) => sum + visit(child), 0);
		folders.set(node.slug, { name: node.name, count });
		return count;
	}
	visit(manifest.tree);
	for (const folder of ['', ...manifest.folders]) {
		if (routes.has(folder)) continue;
		const listing = folders.get(folder);
		if (!listing) continue;
		routes.add(folder);
		const name = folder ? folder.split('/').at(-1) || folder : listing.name;
		inputs.push({
			url: `/${folder}`,
			content: document(
				name,
				`${folder ? courseFilter(folder.split('/')[0]) : ''}<h1>${escapeSearchHtml(name)}</h1><p>${listing.count} ${listing.count === 1 ? 'item' : 'items'} under this folder.</p>`
			)
		});
	}
	const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
	const tags = Object.keys(manifest.tags).sort((a, b) => collator.compare(a, b));
	inputs.push({
		url: '/tags',
		content: document(
			'Tag Index',
			`<h1>Tag Index</h1><p>Found ${tags.length} total tags.</p><ul>${tags.map((tag) => `<li><a href="/tags/${escapeSearchHtml(tag)}">${escapeSearchHtml(tag)} ${manifest.tags[tag].length}</a></li>`).join('')}</ul>`
		)
	});
	for (const tag of tags) {
		const pages = manifest.tags[tag]
			.map((slug) => manifest.pages[slug])
			.filter(Boolean)
			.sort(
				(a, b) =>
					Date.parse(b.dates.modified) - Date.parse(a.dates.modified) ||
					collator.compare(a.title, b.title)
			);
		const title = `Tag: ${tag}`;
		inputs.push({
			url: `/tags/${tag}`,
			content: document(
				title,
				`<h1>${escapeSearchHtml(title)}</h1><p>${pages.length} ${pages.length === 1 ? 'item' : 'items'} with this tag.</p><ul>${pages
					.map((page) => {
						const date = page.dates.modified
							? new Date(page.dates.modified).toLocaleDateString('en-US', {
									year: 'numeric',
									month: 'short',
									day: 'numeric'
								})
							: '';
						return `<li><a href="/${escapeSearchHtml(displayRoute(page.slug))}">${escapeSearchHtml(page.title)} ${escapeSearchHtml(date)}${page.description ? ` ${escapeSearchHtml(page.description)}` : ''}</a></li>`;
					})
					.join('')}</ul>`
			)
		});
	}
	return inputs.sort((a, b) => (a.url || '').localeCompare(b.url || '', 'en'));
}
