import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { publicationFixture } from './publication-fixture';

const fixture = publicationFixture();
const environment = {
	...process.env,
	WISCONSIN_CONTENT_REPO: fixture.repo,
	PUBLICATION_TEST: 'true'
};
function buildAndTest(mode: string, specification: string) {
	for (const command of [
		['run', 'build:all'],
		['x', 'playwright', 'test', specification, '--workers=2']
	]) {
		const result = spawnSync('bun', command, {
			stdio: 'inherit',
			env: { ...environment, PUBLICATION_TEST: mode }
		});
		if (result.status !== 0) throw new Error(`${mode}: bun ${command.join(' ')} failed`);
	}
}
try {
	for (const embed of ['![[slides]]', '![[../exams/restricted.pdf]]']) {
		fixture.write('content/sp99-cs101/notes/public.md', fixture.publicNote + '\n' + embed);
		const result = spawnSync('bun', ['run', 'build:content'], {
			env: { ...environment, VITE_PUBLIC_EDITION: 'true' },
			encoding: 'utf8'
		});
		if (result.status === 0 || !result.stderr.includes('requires explicit publication'))
			throw new Error(
				`Private embed was not rejected: ${embed}\n${result.stdout}\n${result.stderr}`
			);
	}
	fixture.write('content/sp99-cs101/notes/public.md', fixture.publicNote);
	buildAndTest('true', 'publication.spec.ts');
	fixture.write('content/sp99-cs101/publish.yaml', 'include: ["p01/*.java"]\n');
	buildAndTest('files', 'publication-files.spec.ts');
	fixture.write('content/sp99-cs101/publish.yaml', 'include: []\n');
	buildAndTest('revoked', 'publication-revoked.spec.ts');
} finally {
	rmSync(fixture.repo, { recursive: true, force: true });
}
