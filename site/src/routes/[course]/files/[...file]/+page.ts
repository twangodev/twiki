import { error } from '@sveltejs/kit';
import {
	directoryEntries,
	fileIndexUrl,
	fileTree,
	type CourseFile,
	type RmdPreview
} from '$lib/files';
import type { PageLoad } from './$types';

// File routes share a static shell; only their catalog and selected assets are loaded.
export const prerender = false;
export const ssr = false;

export const load: PageLoad = async ({ params, fetch }) => {
	const response = await fetch(fileIndexUrl(params.course));
	if (!response.ok) error(response.status === 404 ? 404 : 503, 'Files unavailable');
	const files: CourseFile[] = await response.json();
	const file = files.find((entry) => entry.path === params.file);
	const entries = file ? undefined : directoryEntries(fileTree(files), params.file);
	if (!file && !entries) error(404, 'File not found');
	let rmd: RmdPreview | undefined;
	if (file?.rmdPreview && !file.locked) {
		const preview = await fetch(file.rmdPreview);
		if (!preview.ok) error(503, 'Worksheet preview unavailable');
		rmd = await preview.json();
	}
	return {
		kind: 'file-browser' as const,
		course: params.course,
		path: params.file,
		files,
		file,
		rmd,
		entries,
		toc: []
	};
};
