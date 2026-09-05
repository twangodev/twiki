import { error } from '@sveltejs/kit';
import { directoryEntries, fileIndexUrl, fileTree, type CourseFile } from '$lib/files';
import { building, dev } from '$app/environment';
import { publicEdition } from '$lib/publication';
import fileEntries from '$lib/generated/file-entries.json';
import type { EntryGenerator, PageServerLoad } from './$types';

export const prerender = publicEdition;
export const entries: EntryGenerator = () => fileEntries;

export const load: PageServerLoad = async ({ params, fetch, platform, url }) => {
	const fetchAsset = (path: string) =>
		dev || building ? fetch(path) : platform!.env.ASSETS.fetch(new Request(new URL(path, url)));
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
