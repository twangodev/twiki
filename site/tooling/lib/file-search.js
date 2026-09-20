/** File names remain searchable without generating an HTML page for each path.
 * @param {{ course: string; file: string }} entry
 */
export function fileSearchRecord({ course, file }) {
	const route = `/${encodeURIComponent(course)}/files${file ? '/' + file.split('/').map(encodeURIComponent).join('/') : ''}`;
	return {
		url: route,
		content: `${course} ${file}`,
		language: 'en',
		meta: { title: file.split('/').at(-1) || course },
		filters: { course: [course] }
	};
}
