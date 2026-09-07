export function textExportUrl(slug: string, format: 'md' | 'txt' = 'md') {
	// Folder index notes are displayed at the folder URL. Home uses /index.md.
	const route = slug.replace(/\/index$/, '');
	return `/${route.split('/').map(encodeURIComponent).join('/')}.${format}`;
}
