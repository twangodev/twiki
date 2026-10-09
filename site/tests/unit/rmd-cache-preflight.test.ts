import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CourseFile } from '../../src/lib/files';
import { buildRmdPreviews } from '../../tooling/lib/rmd-previews';
import { preflightRmdPreviews } from '../../tooling/lib/rmd-preflight';
import {
	captureRRenderProfile,
	rRuntimeVersion,
	verifyRRenderProfile
} from '../../tooling/lib/r-runtime';
import { rmdCourseInputs } from '../../tooling/lib/rmd-preview-cache';

const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
function fixture() {
	const repo = mkdtempSync(path.join(tmpdir(), 'wisconsin-rmd-cache-'));
	const site = path.join(repo, 'site'),
		course = path.join(repo, 'content/test-course');
	const bin = path.join(repo, 'bin'),
		executable = path.join(bin, 'Rscript');
	const output = path.join(site, 'build/generated/assets/_files');
	const write = (file: string, bytes: string, executable = false) => {
		mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
		writeFileSync(path.join(repo, file), bytes, executable ? { mode: 0o755 } : undefined);
	};
	write('font.ttf', 'verified fixture font');
	write('fonts.conf', 'verified fixture config');
	const face = `${path.join(repo, 'font.ttf')}\tFixture\tRegular\t1\tFixture\t0\tTrue\tTrue\t1\t0`;
	for (const command of ['fc-list', 'fc-match'])
		write(`bin/${command}`, `#!/bin/sh\nprintf '%s\\n' ${quote(face)}\n`, true);
	write(
		'bin/fc-conflist',
		`#!/bin/sh\nprintf '%s\\n' ${quote('+ ' + path.join(repo, 'fonts.conf') + ': fixture')}\n`,
		true
	);
	write(
		'bin/Rscript',
		'#!/bin/sh\nif [ "$2" = "-e" ]; then printf "R fixture; knitr 1; native png 1\\n"; else printf "# Worksheet\\n\\nVerified result\\n" > "$4"; fi\n',
		true
	);
	write('content/test-course/worksheet.Rmd', '# Worksheet\n\n```{r}\n1 + 1\n```');
	write('content/test-course/data.csv', 'x\n1\n');
	write('content/test-course/private.md', '# Private dependency');
	write('content/test-course/publish.yaml', 'include:\n  - worksheet.Rmd\n  - data.csv\n');
	write(
		'.gitmodules',
		'[submodule "test-course"]\npath = content/test-course\nurl = https://example.invalid/course\n'
	);
	const git = (root: string, ...args: string[]) =>
		execFileSync(
			'git',
			[
				'-C',
				root,
				'-c',
				'user.name=Test',
				'-c',
				'user.email=test@example.invalid',
				'-c',
				'commit.gpgsign=false',
				...args
			],
			{ stdio: 'pipe' }
		);
	git(repo, 'init', '-q');
	git(course, 'init', '-q');
	git(course, 'add', '.');
	git(course, 'commit', '-qm', 'Fixture');
	git(repo, 'add', '.gitmodules', 'content');
	git(repo, 'commit', '-qm', 'Fixture');
	git(repo, 'config', 'submodule.test-course.active', 'true');
	const files: CourseFile[] = [];
	for (const relative of ['data.csv', 'private.md', 'worksheet.Rmd']) {
		const bytes = readFileSync(path.join(course, relative), 'utf8');
		const blob = `${hash(bytes)}.bin`;
		write(`site/build/generated/assets/_files/blobs/${blob}`, bytes);
		files.push({
			path: relative,
			size: bytes.length,
			kind: 'text',
			note: relative === 'private.md' ? '/test-course/private' : undefined,
			download: `/_files/blobs/${blob}`
		});
	}
	const environment = {
		...process.env,
		PATH: bin + path.delimiter + process.env.PATH,
		RSCRIPT: executable
	};
	const lock = () =>
		write('site/tooling/r-render-profile.json', JSON.stringify(captureRRenderProfile(environment)));
	const publicFiles = () =>
		files.map((file) =>
			file.path === 'private.md' ? { ...file, locked: true, download: undefined } : { ...file }
		);
	return {
		repo,
		site,
		course,
		bin,
		output,
		executable,
		environment,
		files,
		publicFiles,
		write,
		lock,
		git
	};
}

async function withEnvironment<T>(environment: NodeJS.ProcessEnv, callback: () => Promise<T>) {
	const names = [
		'PATH',
		'RSCRIPT',
		'WISCONSIN_R_CACHE_ONLY',
		'WISCONSIN_R_REQUIRE_PROFILE',
		'WISCONSIN_R_RENDER_PROFILE_FILE'
	];
	const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
	for (const name of names)
		if (environment[name] === undefined) delete process.env[name];
		else process.env[name] = environment[name];
	try {
		return await callback();
	} finally {
		for (const name of names)
			if (previous[name] === undefined) delete process.env[name];
			else process.env[name] = previous[name];
	}
}

test('restored previews pass exact public/full preflight and build without any R executable', async () => {
	const fixtureData = fixture();
	const { repo, site, output, environment, files, publicFiles, lock, executable } = fixtureData;
	try {
		lock();
		await withEnvironment(environment, async () => {
			await buildRmdPreviews(site, 'test-course', files, output, () => {});
			await buildRmdPreviews(site, 'test-course', publicFiles(), output, () => {});
		});
		const restored = path.join(repo, 'fresh-site');
		cpSync(path.join(site, 'build/generated/cache'), path.join(restored, 'build/generated/cache'), {
			recursive: true
		});
		cpSync(path.join(site, 'tooling'), path.join(restored, 'tooling'), { recursive: true });
		rmSync(executable);
		const preflight = await preflightRmdPreviews(restored, repo, environment);
		expect(preflight).toMatchObject({
			requiresR: false,
			verified: 2,
			worksheets: 2,
			reason: 'verified'
		});
		await withEnvironment({ ...environment, WISCONSIN_R_CACHE_ONLY: '1' }, async () => {
			const retained: string[] = [];
			await buildRmdPreviews(
				restored,
				'test-course',
				files,
				path.join(restored, 'output'),
				(file) => retained.push(file)
			);
			expect(files.find((file) => file.path === 'worksheet.Rmd')!.rmdPreview).toMatch(
				/^\/_files\/blobs\/[a-f0-9]{64}\.json$/
			);
			expect(retained.length).toBeGreaterThan(0);
		});
		fixtureData.write('content/test-course/data.csv', 'x\n2\n');
		expect(await preflightRmdPreviews(restored, repo, environment)).toMatchObject({
			requiresR: true,
			reason: 'missing-or-stale'
		});
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test('corruption, dependency membership changes, unverified fonts and missing lock require a real renderer', async () => {
	const { repo, site, course, output, environment, files, publicFiles, lock, write, git } =
		fixture();
	try {
		lock();
		await withEnvironment(environment, async () => {
			await buildRmdPreviews(site, 'test-course', files, output, () => {});
			await buildRmdPreviews(site, 'test-course', publicFiles(), output, () => {});
		});
		expect((await preflightRmdPreviews(site, repo, environment)).requiresR).toBe(false);
		const cacheRoot = path.join(site, 'build/generated/cache/rmd');
		const directory = path.join(
			cacheRoot,
			readdirSync(cacheRoot).find((key) =>
				JSON.parse(
					JSON.parse(readFileSync(path.join(cacheRoot, key, 'result.json'), 'utf8')).inputs
				).available.some(([name]: [string, string]) => name === 'private.md')
			)!
		);
		const record = JSON.parse(readFileSync(path.join(directory, 'result.json'), 'utf8'));
		const previewFile = path.join(directory, record.preview);
		const bytes = readFileSync(previewFile);
		writeFileSync(previewFile, Buffer.alloc(bytes.length, 32));
		expect((await preflightRmdPreviews(site, repo, environment)).requiresR).toBe(true);
		await withEnvironment({ ...environment, WISCONSIN_R_CACHE_ONLY: '1' }, async () => {
			await expect(buildRmdPreviews(site, 'test-course', files, output, () => {})).rejects.toThrow(
				'missing or stale'
			);
		});
		writeFileSync(previewFile, bytes);
		write('content/test-course/new.csv', 'new dependency');
		git(course, 'add', 'new.csv');
		expect((await preflightRmdPreviews(site, repo, environment)).requiresR).toBe(true);
		git(course, 'reset', '--', 'new.csv');
		const matchScript = readFileSync(path.join(repo, 'bin/fc-match'));
		write('bin/fc-match', '#!/bin/sh\nexit 0\n', true);
		expect((await preflightRmdPreviews(site, repo, environment)).requiresR).toBe(true);
		writeFileSync(path.join(repo, 'bin/fc-match'), matchScript);
		const inventoryScript = readFileSync(path.join(repo, 'bin/fc-list'));
		write('bin/fc-list', '#!/bin/sh\nexit 0\n', true);
		expect((await preflightRmdPreviews(site, repo, environment)).requiresR).toBe(true);
		writeFileSync(path.join(repo, 'bin/fc-list'), inventoryScript);
		expect(
			(await preflightRmdPreviews(site, repo, { ...environment, PATH: '/missing-font-tools' }))
				.requiresR
		).toBe(true);
		write('fonts.conf', 'changed verified config');
		expect((await preflightRmdPreviews(site, repo, environment)).requiresR).toBe(true);
		rmSync(path.join(site, 'tooling/r-render-profile.json'));
		expect((await preflightRmdPreviews(site, repo, environment)).requiresR).toBe(true);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test('CI requires its pinned renderer while normal local R can use a different actual package profile', async () => {
	const { repo, site, output, environment, executable, files, lock } = fixture();
	try {
		lock();
		writeFileSync(
			executable,
			'#!/bin/sh\nif [ "$2" = "-e" ]; then printf "R fixture; knitr 2; native png 1\\n"; else printf "# Worksheet\\n\\nNew local renderer\\n" > "$4"; fi\n',
			{ mode: 0o755 }
		);
		const runtime = rRuntimeVersion(environment, true);
		expect(() =>
			verifyRRenderProfile(site, runtime, { ...environment, WISCONSIN_R_REQUIRE_PROFILE: '1' })
		).toThrow('does not match');
		expect(() => verifyRRenderProfile(site, runtime, environment)).not.toThrow();
		await withEnvironment(environment, async () => {
			await buildRmdPreviews(site, 'test-course', files, output, () => {});
			expect(files.find((file) => file.path === 'worksheet.Rmd')!.rmdPreview).toBeDefined();
		});
		expect((await preflightRmdPreviews(site, repo, environment)).requiresR).toBe(true);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test('profile capture and GitHub preflight CLI emit only verified dependency identity and whitelisted counts', () => {
	const { repo, site, environment } = fixture();
	try {
		const cli = path.resolve(import.meta.dirname, '../../tooling/r-cache.ts');
		const captured = path.join(repo, 'captured/profile.json');
		const bytes = execFileSync('bun', [cli, 'capture-profile', '--output', captured], {
			env: environment,
			encoding: 'utf8'
		});
		const profile = JSON.parse(bytes);
		expect(profile.runtimeSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(JSON.parse(readFileSync(captured, 'utf8'))).toEqual(profile);
		expect(bytes).not.toContain('worksheet.Rmd');
		expect(bytes).not.toContain('Private dependency');
		const githubOutput = path.join(repo, 'github-output');
		const result = JSON.parse(
			execFileSync('bun', [cli, 'preflight', '--github-output'], {
				env: {
					...environment,
					WISCONSIN_CONTENT_REPO: repo,
					WISCONSIN_R_RENDER_PROFILE_FILE: captured,
					GITHUB_OUTPUT: githubOutput
				},
				encoding: 'utf8'
			})
		);
		expect(result.requiresR).toBe(true);
		expect(readFileSync(githubOutput, 'utf8')).toBe('requiresR=true\nworksheets=2\nverified=0\n');
		const incompatible = { ...profile, architecture: 'incompatible' };
		mkdirSync(path.join(site, 'tooling'), { recursive: true });
		writeFileSync(path.join(site, 'tooling/r-render-profile.json'), JSON.stringify(incompatible));
		expect(() =>
			verifyRRenderProfile(site, rRuntimeVersion(environment), {
				...environment,
				WISCONSIN_R_REQUIRE_PROFILE: '1'
			})
		).toThrow('incompatible');
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test('locked catalog additions invalidate rendered wikilinks while authorized source embeds remain reusable', async () => {
	const {
		repo,
		site,
		course,
		output,
		environment,
		executable,
		files,
		publicFiles,
		lock,
		write,
		git
	} = fixture();
	try {
		writeFileSync(
			executable,
			`#!/bin/sh\nif [ "$2" = "-e" ]; then printf "R fixture; knitr 1; native png 1\\n"; else printf '%s\\n' ${quote('# Worksheet\n\n[[private]]\n\n![[picture.png]]')} > "$4"; fi\n`,
			{ mode: 0o755 }
		);
		const image = 'fixture image bytes',
			imageBlob = `${hash(image)}.png`;
		write('content/test-course/picture.png', image);
		write(`site/build/generated/assets/_files/blobs/${imageBlob}`, image);
		write(
			'content/test-course/publish.yaml',
			'include:\n  - worksheet.Rmd\n  - data.csv\n  - picture.png\n'
		);
		git(course, 'add', 'picture.png', 'publish.yaml');
		files.push({
			path: 'picture.png',
			size: image.length,
			kind: 'image',
			download: `/_files/blobs/${imageBlob}`
		});
		files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
		lock();
		let published = publicFiles();
		const preview = () =>
			JSON.parse(
				readFileSync(
					path.join(
						output,
						'blobs',
						path.basename(published.find((file) => file.path === 'worksheet.Rmd')!.rmdPreview!)
					),
					'utf8'
				)
			);
		await withEnvironment(environment, async () => {
			await buildRmdPreviews(site, 'test-course', files, output, () => {});
			await buildRmdPreviews(site, 'test-course', published, output, () => {});
		});
		expect((await preflightRmdPreviews(site, repo, environment)).requiresR).toBe(false);
		expect(preview().html).toContain(`src="/_files/blobs/${imageBlob}"`);
		expect(preview().html).toContain('href="/test-course/private"');
		await withEnvironment({ ...environment, WISCONSIN_R_CACHE_ONLY: '1' }, async () => {
			await buildRmdPreviews(site, 'test-course', published, output, () => {});
		});
		const before = JSON.parse(rmdCourseInputs(published));
		write(
			'content/test-course/extra/private.md',
			'private body must not reach the rendered preview'
		);
		git(course, 'add', 'extra/private.md');
		published.push({
			path: 'extra/private.md',
			size: 48,
			kind: 'binary',
			locked: true,
			note: '/test-course/extra/private'
		});
		published.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
		expect(JSON.parse(rmdCourseInputs(published)).available).toEqual(before.available);
		expect(rmdCourseInputs(published)).not.toBe(JSON.stringify(before));
		expect((await preflightRmdPreviews(site, repo, environment)).requiresR).toBe(true);
		await withEnvironment({ ...environment, WISCONSIN_R_CACHE_ONLY: '1' }, async () => {
			await expect(
				buildRmdPreviews(site, 'test-course', published, output, () => {})
			).rejects.toThrow('missing or stale');
		});
		await withEnvironment(environment, async () => {
			await buildRmdPreviews(site, 'test-course', published, output, () => {});
		});
		expect(preview().html).toContain('href="/test-course/private"');
		expect(preview().html).not.toContain('private body must not reach');
		git(course, 'rm', '--cached', 'extra/private.md');
		write('content/test-course/private.md', '---\ndraft: true\n---\n# Private dependency');
		published = published
			.filter((file) => file.path !== 'extra/private.md')
			.map((file) => (file.path === 'private.md' ? { ...file, note: undefined } : file));
		expect(await preflightRmdPreviews(site, repo, environment)).toMatchObject({
			requiresR: true,
			verified: 0
		});
		await withEnvironment({ ...environment, WISCONSIN_R_CACHE_ONLY: '1' }, async () => {
			await expect(
				buildRmdPreviews(site, 'test-course', published, output, () => {})
			).rejects.toThrow('missing or stale');
		});
		await withEnvironment(environment, async () => {
			await buildRmdPreviews(site, 'test-course', published, output, () => {});
		});
		expect(preview().html).toContain('href="/test-course/files/private.md"');
		expect(await preflightRmdPreviews(site, repo, environment)).toMatchObject({
			requiresR: true,
			verified: 1
		});
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});
