import { discoverSourceFiles, resolveProject, type ResolvedProject } from './lib/project-config';
import { publicationResolver } from './lib/publishing';

/** Report policy decisions using the same configuration and discovery as the compiler. */
export function publicationReport(project: ResolvedProject, requested?: string) {
	const decide = publicationResolver(project.root, project);
	return discoverSourceFiles(project)
		.filter((file) => !requested || file === requested || file.startsWith(requested + '/'))
		.map((file) => ({ path: file, ...decide(file) }));
}

if (import.meta.main) {
	const requested = process.argv[2]?.replace(/\/$/, '');
	const entries = publicationReport(resolveProject(), requested);
	for (const entry of entries) {
		if (requested || entry.public)
			console.log(`${entry.public ? 'PUBLIC ' : 'PRIVATE'} ${entry.path} — ${entry.reason}`);
	}
	console.log(
		`${entries.filter((entry) => entry.public).length} files selected for publication; normal content and file safety filters still apply.`
	);
}
