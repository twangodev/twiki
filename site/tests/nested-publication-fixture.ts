import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { publicationFixture } from './publication-fixture';

/** An initialized local nested repository; this fixture performs no clone or fetch. */
export function nestedPublicationFixture(fixture: ReturnType<typeof publicationFixture>) {
	const nested = path.join(fixture.course, 'projects');
	const git = (directory: string, ...args: string[]) =>
		execFileSync(
			'git',
			[
				'-C',
				directory,
				'-c',
				'user.name=Publication Test',
				'-c',
				'user.email=test@example.invalid',
				'-c',
				'commit.gpgsign=false',
				...args
			],
			{ stdio: 'pipe' }
		);
	fixture.write(
		'content/sp99-cs101/projects/nested.md',
		'# Nested project\n\nNested initial body.\n'
	);
	git(nested, 'init');
	git(nested, 'add', '.');
	git(nested, 'commit', '-m', 'Add nested project');
	fixture.write(
		'content/sp99-cs101/.gitmodules',
		'[submodule "projects"]\n\tpath = projects\n\turl = https://example.invalid/projects.git\n'
	);
	git(fixture.course, 'add', '.gitmodules', 'projects');
	git(fixture.course, 'commit', '-m', 'Add nested repository');
	git(fixture.course, 'config', 'submodule.projects.active', 'true');
	return { nested, git };
}
