import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
	rRendererIdentity,
	rRuntimeVersion,
	freshRRuntimeVersion
} from '../../tooling/lib/r-runtime';
import { contentInputFingerprint } from '../../tooling/lib/dev-state';
import { publicationFixture } from '../publication-fixture';

test('unverified fonts keep refreshed renderer and source fingerprints stable within a process', async () => {
	const { repo, course, write } = publicationFixture();
	const bin = path.join(repo, 'bin');
	const executable = path.join(repo, 'Rscript');
	const environment = { ...process.env, PATH: bin, RSCRIPT: executable };
	try {
		mkdirSync(bin);
		writeFileSync(executable, '#!/bin/sh\necho "R test; knitr 1"\n', { mode: 0o755 });
		write('content/sp99-cs101/worksheet.Rmd', '# Worksheet');
		execFileSync('git', ['-C', course, 'add', 'worksheet.Rmd']);
		const first = rRendererIdentity(repo, environment);
		const firstInputs = await contentInputFingerprint(repo, first);
		expect(first).toContain('fontconfig-unverified-v1:');
		const refreshed = rRendererIdentity(repo, environment);
		expect(refreshed).toBe(first);
		expect(await contentInputFingerprint(repo, refreshed)).toBe(firstInputs);
		expect(rRendererIdentity(repo, { ...environment, FONTCONFIG_FILE: 'changed.conf' })).not.toBe(
			first
		);
		writeFileSync(executable, '#!/bin/sh\necho "R test; knitr 2"\n', { mode: 0o755 });
		expect(rRendererIdentity(repo, environment)).not.toBe(first);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test('saved dev inputs follow R availability, selection and package versions without restarting', async () => {
	const { repo, course, write } = publicationFixture();
	const executable = path.join(repo, 'Rscript');
	const environment = { ...process.env, RSCRIPT: executable };
	try {
		// Untracked worksheets cannot be compiled and should not trigger an R process.
		write('content/sp99-cs101/worksheet.Rmd', '# Worksheet');
		expect(rRendererIdentity(repo, environment)).toBe('unused');
		execFileSync('git', ['-C', course, 'add', 'worksheet.Rmd']);
		const inputs = async () =>
			await contentInputFingerprint(repo, rRendererIdentity(repo, environment));
		const absent = await inputs();
		writeFileSync(
			executable,
			'#!/bin/sh\necho "R test; knitr 1; evaluate 1; highr 1; xfun 1; yaml 1"\n',
			{ mode: 0o755 }
		);
		const available = await inputs();
		expect(available).not.toBe(absent);
		expect(rRuntimeVersion(environment)).toContain('knitr 1');
		writeFileSync(
			executable,
			'#!/bin/sh\necho "R test; knitr 2; evaluate 1; highr 1; xfun 1; yaml 1"\n',
			{ mode: 0o755 }
		);
		expect(await inputs()).not.toBe(available);
		expect(rRuntimeVersion(environment)).toContain('knitr 2');
		expect(rRendererIdentity(repo, { ...environment, RSCRIPT: '/missing-runtime' })).not.toBe(
			rRendererIdentity(repo, environment)
		);
		rmSync(executable);
		expect(await inputs()).toBe(absent);
		expect(() => rRuntimeVersion(environment)).toThrow('require R and knitr');
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test('refresh catches installed package changes even when the selected executable stays unchanged', async () => {
	const { repo, course, write } = publicationFixture();
	const executable = path.join(repo, 'Rscript');
	const packages = path.join(repo, 'versions');
	const environment = { ...process.env, RSCRIPT: executable };
	try {
		write('content/sp99-cs101/worksheet.Rmd', '# Worksheet');
		execFileSync('git', ['-C', course, 'add', 'worksheet.Rmd']);
		writeFileSync(executable, '#!/bin/sh\ncat "$(dirname "$0")/versions"\n', { mode: 0o755 });
		writeFileSync(packages, 'R test; knitr 1');
		const first = rRendererIdentity(repo, environment);
		writeFileSync(packages, 'R test; knitr 2');
		expect(rRendererIdentity(repo, environment)).not.toBe(first);
		expect(rRuntimeVersion(environment)).toContain('knitr 2');
		rmSync(packages);
		expect(rRendererIdentity(repo, environment)).not.toContain('knitr 2');
		expect(() => rRuntimeVersion(environment)).toThrow('require R and knitr');
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test('declared initialized courses contribute renderer identity before their gitlink is staged', async () => {
	const { repo, course, write } = publicationFixture();
	const executable = path.join(repo, 'Rscript');
	const environment = { ...process.env, RSCRIPT: executable };
	try {
		write('content/sp99-cs101/worksheet.Rmd', '# Worksheet');
		execFileSync('git', ['-C', course, 'add', 'worksheet.Rmd']);
		execFileSync('git', ['-C', repo, 'rm', '--cached', '-f', 'content/sp99-cs101']);
		const absent = rRendererIdentity(repo, environment);
		expect(absent).not.toBe('unused');
		writeFileSync(executable, '#!/bin/sh\necho "R test; knitr 1"\n', { mode: 0o755 });
		expect(rRendererIdentity(repo, environment)).not.toBe(absent);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test('worksheet package and transitive dependency changes invalidate R identity with the same executable', async () => {
	const { repo, course, write } = publicationFixture();
	const executable = path.join(repo, 'Rscript');
	const packages = path.join(repo, 'versions');
	const environment = { ...process.env, RSCRIPT: executable };
	try {
		write('content/sp99-cs101/worksheet.Rmd', '# Worksheet');
		execFileSync('git', ['-C', course, 'add', 'worksheet.Rmd']);
		writeFileSync(executable, '#!/bin/sh\ncat "$(dirname "$0")/versions"\n', { mode: 0o755 });
		writeFileSync(packages, 'R test; knitr 1\ncar 3.1.2 4.5.0\ncarData 3.0.5 4.5.0');
		const first = rRendererIdentity(repo, environment);
		writeFileSync(packages, 'R test; knitr 1\ncar 3.1.3 4.5.0\ncarData 3.0.5 4.5.0');
		const changedCar = rRendererIdentity(repo, environment);
		expect(changedCar).not.toBe(first);
		writeFileSync(packages, 'R test; knitr 1\ncar 3.1.3 4.5.0\ncarData 3.0.6 4.5.0');
		expect(rRendererIdentity(repo, environment)).not.toBe(changedCar);
		writeFileSync(packages, 'R test; knitr 1');
		expect(rRendererIdentity(repo, environment)).not.toBe(first);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test('concurrent preview provenance matches sync probes and refreshes unchanged executables', async () => {
	const { repo } = publicationFixture();
	const executable = path.join(repo, 'Rscript');
	const packages = path.join(repo, 'versions');
	const environment = { ...process.env, PATH: repo, RSCRIPT: executable };
	try {
		writeFileSync(executable, '#!/bin/sh\n/bin/cat "$VERSIONS"\n', { mode: 0o755 });
		const selected = { ...environment, VERSIONS: packages };
		writeFileSync(packages, 'R test; knitr 1');
		expect(await freshRRuntimeVersion(selected)).toBe(rRuntimeVersion(selected, true));
		writeFileSync(packages, 'R test; knitr 2');
		expect(await freshRRuntimeVersion(selected)).toContain('knitr 2');
		expect(rRuntimeVersion(selected)).toContain('knitr 2');
		rmSync(packages);
		await expect(freshRRuntimeVersion(selected)).rejects.toThrow('require R and knitr');
		expect(() => rRuntimeVersion(selected)).toThrow('require R and knitr');
		await expect(
			freshRRuntimeVersion({ ...selected, RSCRIPT: '/missing-r-preview' })
		).rejects.toThrow('require R and knitr');
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test('concurrent preview runtime subprocess stops when its request is aborted', async () => {
	const { repo } = publicationFixture();
	const executable = path.join(repo, 'Rscript');
	const abort = new AbortController();
	try {
		writeFileSync(executable, '#!/bin/sh\nexec /bin/sleep 10\n', { mode: 0o755 });
		const pending = freshRRuntimeVersion(
			{ ...process.env, PATH: repo, RSCRIPT: executable },
			abort.signal
		);
		abort.abort();
		await expect(pending).rejects.toThrow('require R and knitr');
	} finally {
		abort.abort();
		rmSync(repo, { recursive: true, force: true });
	}
});
