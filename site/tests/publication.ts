import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { publicationFixture } from './publication-fixture';

const fixture = publicationFixture();
const environment = {
	...process.env,
	WISCONSIN_CONTENT_REPO: fixture.repo,
	PUBLICATION_TEST: 'true'
};
function buildAndTest(mode: string, specification: string) {
	const testFile = `/${specification.replaceAll('.', '\\.')}$`;
	for (const command of [
		['run', 'build:all'],
		['x', 'playwright', 'test', testFile, '--workers=2']
	]) {
		const result = spawnSync('bun', command, {
			stdio: 'inherit',
			env: {
				...environment,
				PUBLICATION_TEST: command[0] === 'run' && mode === 'updated' ? 'true' : mode
			}
		});
		if (result.status !== 0) throw new Error(`${mode}: bun ${command.join(' ')} failed`);
	}
}
try {
	for (const embed of ['![[slides]]', '![[../exams/restricted.pdf]]']) {
		fixture.write('content/sp99-cs101/notes/public.md', fixture.publicNote + '\n' + embed);
		const result = spawnSync('bun', ['run', 'content:prepare'], {
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
	const previousDescriptor = JSON.parse(
		readFileSync('build/.svelte-kit/cloudflare/_content/current.json', 'utf8')
	);
	// Keep the application unchanged while replacing the content snapshot.
	fixture.write(
		'content/sp99-cs101/notes/public.md',
		fixture.publicNote
			.replaceAll('Public derivations', 'Updated public derivations')
			.replace('publicsearchcanary', 'snapshotupdatedcanary')
	);
	fixture.write(
		'content/sp99-cs101/notes/second.md',
		'# Updated second derivation\n\nNew snapshot explanation.\n\n[[public]]'
	);
	buildAndTest('updated', 'publication-updated.spec.ts');
	const updatedDescriptor = JSON.parse(
		readFileSync('build/.svelte-kit/cloudflare/_content/current.json', 'utf8')
	);
	if (previousDescriptor.applicationVersion !== updatedDescriptor.applicationVersion)
		throw new Error('Content-only edit changed the application version');
	if (
		previousDescriptor.snapshots.public === updatedDescriptor.snapshots.public ||
		previousDescriptor.snapshots.full === updatedDescriptor.snapshots.full
	)
		throw new Error('Content-only edit failed to replace both edition snapshots');
	fixture.write('content/sp99-cs101/notes/public.md', fixture.publicNote);
	fixture.write('content/sp99-cs101/publish.yaml', 'include: ["p01/*.java"]\n');
	buildAndTest('files', 'publication-files.spec.ts');
	fixture.write('content/sp99-cs101/publish.yaml', 'include: []\n');
	buildAndTest('revoked', 'publication-revoked.spec.ts');
} finally {
	rmSync(fixture.repo, { recursive: true, force: true });
}
