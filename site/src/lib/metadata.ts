import { site } from './config';
import type { ManifestPage } from './types';

export interface ContentAuthor {
	name: string;
	url?: string;
	type: 'Person' | 'Organization';
}

export const curator: ContentAuthor = {
	name: site.author.name,
	url: site.author.url,
	type: 'Person'
};

export function contentAuthor(value: unknown): ContentAuthor | undefined {
	if (typeof value === 'string')
		return value.trim() ? { name: value.trim(), type: 'Person' } : undefined;
	if (!value || typeof value !== 'object' || Array.isArray(value)) return;
	const author = value as Record<string, unknown>;
	if (typeof author.name !== 'string' || !author.name.trim()) return;
	let url: string | undefined;
	if (typeof author.url === 'string') {
		try {
			const parsed = new URL(author.url);
			if (['https:', 'http:'].includes(parsed.protocol)) url = parsed.href;
		} catch {}
	}
	return {
		name: author.name.trim(),
		type: author.type === 'Organization' ? 'Organization' : 'Person',
		...(url ? { url } : {})
	};
}

export function pageAuthor(
	page: Pick<ManifestPage, 'slug' | 'license'> & { author?: ContentAuthor }
) {
	return page.author ?? (/^[^/]+\/README$/.test(page.slug) && !page.license ? curator : undefined);
}

export function breadcrumbs(route: string, title: string) {
	const segments = route
		.replace(/^\/|\/$/g, '')
		.split('/')
		.filter(Boolean);
	if (!segments.length) return [];
	return [
		{ label: 'Home', href: '/' },
		...segments.map((segment, index) => ({
			label: index === segments.length - 1 ? title : segment,
			href: '/' + segments.slice(0, index + 1).join('/')
		}))
	];
}

export function canonicalUrl(route: string) {
	return new URL('/' + route.replace(/^\/+/, ''), site.url).href;
}

export function serializeSchema(schema: Record<string, unknown>) {
	return JSON.stringify(schema)
		.replaceAll('<', '\\u003c')
		.replaceAll('>', '\\u003e')
		.replaceAll('&', '\\u0026');
}

function personSchema(author: ContentAuthor) {
	return { '@type': author.type, name: author.name, ...(author.url ? { url: author.url } : {}) };
}

export function collectionSchema(route: string, title: string, description: string) {
	const url = canonicalUrl(route);
	const website = {
		'@context': 'https://schema.org',
		'@type': 'WebSite',
		'@id': `${site.url}/#website`,
		url: `${site.url}/`,
		name: site.name,
		description: site.description,
		inLanguage: site.language,
		publisher: personSchema(curator)
	};
	const collection = {
		'@context': 'https://schema.org',
		'@type': 'CollectionPage',
		'@id': `${url}#webpage`,
		url,
		name: title,
		description,
		inLanguage: site.language,
		isPartOf: { '@id': website['@id'] }
	};
	return [website, collection, ...breadcrumbSchema(route, title)];
}

function breadcrumbSchema(route: string, title: string) {
	const trail = breadcrumbs(route, title);
	return trail.length
		? [
				{
					'@context': 'https://schema.org',
					'@type': 'BreadcrumbList',
					itemListElement: trail.map((crumb, index) => ({
						'@type': 'ListItem',
						position: index + 1,
						name: crumb.label,
						item: canonicalUrl(crumb.href)
					}))
				}
			]
		: [];
}

export function noteSchema(route: string, page: Omit<ManifestPage, 'backlinks'>) {
	if (page.locked || !page.publication.public) return [];
	const url = canonicalUrl(route);
	const author = pageAuthor(page);
	const collection =
		page.slug === 'index' || page.slug.endsWith('/index') || /^[^/]+\/README$/.test(page.slug);
	const schema = {
		'@context': 'https://schema.org',
		'@type': collection ? 'CollectionPage' : 'Article',
		'@id': `${url}#${collection ? 'webpage' : 'article'}`,
		url,
		name: page.title,
		headline: page.title,
		description: page.description,
		mainEntityOfPage: url,
		inLanguage: site.language,
		isPartOf: { '@id': `${site.url}/#website` },
		...(author ? { author: personSchema(author) } : {}),
		editor: personSchema(curator),
		...(page.dates.created ? { dateCreated: page.dates.created } : {}),
		...(page.dates.modified ? { dateModified: page.dates.modified } : {}),
		...(page.dates.published ? { datePublished: page.dates.published } : {}),
		...(page.tags.length ? { keywords: page.tags } : {}),
		...(!collection ? { wordCount: page.wordCount } : {}),
		isAccessibleForFree: true,
		...(page.license
			? {
					license: page.license.url,
					creditText: page.license.attribution,
					isBasedOn: page.license.source
				}
			: {})
	};
	return [
		collectionSchema('', site.name, site.description)[0],
		schema,
		...breadcrumbSchema(route, page.title)
	];
}
