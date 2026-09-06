import { site } from './config';

export const socialImageSize = { width: 1200, height: 630 };

export function socialImagePath(slug?: string) {
	return slug
		? `/_og/notes/${slug.split('/').map(encodeURIComponent).join('/')}.png`
		: '/_og/default.png';
}

export function socialImageUrl(slug?: string) {
	return site.url + socialImagePath(slug);
}
