import { readdirSync } from 'node:fs';
import path from 'node:path';

export function publicAssetManifest(directory: string, pages: Record<string, string>) {
	const assets: Record<string, string> = {};
	function walk(relative = '') {
		for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true })) {
			const file = relative ? `${relative}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(file);
			else if (
				!file.startsWith('.') &&
				!['_headers', '_redirects', '404.html'].includes(file) &&
				!file.endsWith('.html')
			) {
				const url = '/' + file.split('/').map(encodeURIComponent).join('/');
				assets[url] = `/_published${url}`;
			}
		}
	}
	walk();
	for (const [route, file] of Object.entries(pages)) {
		if (route === '/404') continue;
		const target = file === 'index.html' ? '' : file.replace(/\.html$/, '');
		const url = route.split('/').map(encodeURIComponent).join('/');
		assets[url] = target
			? `/_published/${target.split('/').map(encodeURIComponent).join('/')}`
			: '/_published';
	}
	return assets;
}
