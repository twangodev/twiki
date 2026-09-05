import { error } from '@sveltejs/kit';
import { directoryEntries, fileIndexUrl, fileTree, type CourseFile } from '$lib/files';
import { dev } from '$app/environment';
import type { PageServerLoad } from './$types';

export const prerender = false;

export const load: PageServerLoad = async ({ params, fetch, platform, url }) => {
	const fetchAsset = (path: string) =>
		dev ? fetch(path) : platform!.env.ASSETS.fetch(new Request(new URL(path, url)));
	const response = await fetchAsset(fileIndexUrl(params.course));
	if (!response.ok) error(response.status === 404 ? 404 : 503, 'Files unavailable');
	const files: CourseFile[] = await response.json();
	const file = files.find((entry) => entry.path === params.file);
	const entries = file ? undefined : directoryEntries(fileTree(files), params.file);
	if (!file && !entries) error(404, 'File not found');
	return {
		kind: 'file-browser' as const,
		course: params.course,
		path: params.file,
		files,
		file,
		entries,
		toc: []
	};
};
