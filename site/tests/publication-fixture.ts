import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function publicationFixture() {
	const repo = mkdtempSync(path.join(tmpdir(), 'wisconsin-publication-'));
	const course = path.join(repo, 'content/sp99-cs101');
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
	const write = (file: string, content: string) => {
		mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
		writeFileSync(path.join(repo, file), content);
	};
	write('content/index.md', '# Private workspace\n\nrootprivatecanary');
	write('content/sp99-cs101/notes/public.md', '# Old private revision\n\nhistoryprivatecanary');
	git(repo, 'init');
	git(course, 'init');
	git(course, 'add', '.');
	git(course, 'commit', '-m', 'Initial private revision');
	const publicNote =
		'---\ntitle: Public derivations\ntags: [practice]\n---\n# Public derivations\n\npublicsearchcanary\n\n[[slides|Restricted reference]]\n\n[[second|Next derivation]]\n\n![[figure.svg]]\n';
	write('content/sp99-cs101/notes/public.md', publicNote);
	write(
		'content/sp99-cs101/notes/draft.md',
		'---\ndraft: true\n---\n# Unfinished\n\ndraftprivatecanary'
	);
	write(
		'content/sp99-cs101/notes/second.md',
		'# Second derivation\n\nAnother public explanation.\n\n[[public]]'
	);
	write(
		'content/sp99-cs101/notes/slides.md',
		'---\ntags: [lectures, systems/distributed]\n---\n# Private lecture slides\n\nlectureprivatecanary\n\n## Public heading outline\n\nlectureprivatecanary\n\n### Nested heading\n\n[[public]]'
	);
	write(
		'content/sp99-cs101/notes/figure.svg',
		'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="8"/></svg>'
	);
	write('content/sp99-cs101/README.md', '# Restricted overview\n\noverviewprivatecanary');
	write(
		'content/sp99-cs101/p01/private/outline.md',
		'# Private directory note\n\n## Visible heading\n\nlectureprivatecanary'
	);
	write(
		'content/sp99-cs101/p01/Main.java',
		'class Main { public static void main(String[] args) {} }\n'
	);
	write('content/sp99-cs101/p01/Résumé Test.java', 'class Helper {}\n');
	write(
		'content/sp99-cs101/p01/private/Answer.java',
		'class Answer { String secret = "answerprivatecanary"; }'
	);
	write('content/sp99-cs101/exams/shared.pdf', '%PDF-1.4\npublic PDF fixture\n%%EOF');
	write('content/sp99-cs101/exams/restricted.pdf', '%PDF-1.4\nexamprivatecanary\n%%EOF');
	write(
		'content/sp99-cs101/publish.yaml',
		'include:\n  - notes/public.md\n  - notes/second.md\n  - notes/draft.md\n  - notes/figure.svg\n  - p01/**/*.java\n  - exams/shared.pdf\nexclude:\n  - p01/private/**\nlicense:\n  name: CC BY 4.0\n  url: https://creativecommons.org/licenses/by/4.0/\n  attribution: Example author\n  source: https://example.com/course\n  changes: Reformatted as Markdown.\n'
	);
	git(course, 'add', '.');
	git(course, 'commit', '-m', 'Publish selected current files');
	write(
		'.gitmodules',
		'[submodule "sp99-cs101"]\n\tpath = content/sp99-cs101\n\turl = https://example.invalid/course.git\n'
	);
	git(repo, 'add', '.');
	git(repo, 'commit', '-m', 'Add fixture course');
	git(repo, 'config', 'submodule.sp99-cs101.active', 'true');
	return { repo, course, publicNote, write };
}
