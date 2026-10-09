import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const executable = process.env.RSCRIPT ?? 'Rscript';
const available =
	spawnSync(
		executable,
		['--vanilla', '-e', 'quit(status = if (requireNamespace("knitr", quietly = TRUE)) 0 else 1)'],
		{ timeout: 30_000, stdio: 'pipe' }
	).status === 0;
const runner = path.resolve(import.meta.dirname, '../../tooling/lib/knit-rmd.R');

function knit(code: string) {
	const temporary = mkdtempSync(path.join(tmpdir(), 'wisconsin-knit-policy-'));
	const input = path.join(temporary, 'worksheet.Rmd');
	const output = path.join(temporary, 'rendered.md');
	const figures = path.join(temporary, 'figures');
	mkdirSync(figures);
	writeFileSync(input, `# Worksheet\n\n\`\`\`{r, echo=FALSE}\n${code}\n\`\`\`\n`);
	const result = spawnSync(executable, ['--vanilla', runner, input, output, figures], {
		encoding: 'utf8',
		timeout: 30_000
	});
	return { temporary, output, result };
}

test.skipIf(!available)(
	'worksheet package setup reuses installed packages without evaluating repository arguments or changing libraries',
	() => {
		const { temporary, output, result } = knit(`
before <- sort(list.files(.libPaths()[[1]], all.files = TRUE))
install.packages(c("knitr", "knitr"), repos = stop("Repository must not be evaluated"))
stopifnot(identical(before, sort(list.files(.libPaths()[[1]], all.files = TRUE))))
stopifnot(!identical(install.packages, utils::install.packages))
stopifnot(identical(environment(utils::install.packages), asNamespace("utils")))
cat("PREINSTALLED_SETUP_OK")
`);
		try {
			expect(result.error).toBeUndefined();
			expect(result.status).toBe(0);
			expect(readFileSync(output, 'utf8')).toContain('PREINSTALLED_SETUP_OK');
		} finally {
			rmSync(temporary, { recursive: true, force: true });
		}
	}
);

test.skipIf(!available)(
	'missing worksheet package fails with an actionable error before subsequent R code runs',
	() => {
		const { temporary, result } = knit(`
install.packages(c("knitr", "wisconsinMissingPackageForRendererFixture"))
cat("MUST_NOT_RENDER_AFTER_MISSING_DEPENDENCY")
`);
		try {
			expect(result.error).toBeUndefined();
			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain(
				'Missing preinstalled R packages: wisconsinMissingPackageForRendererFixture'
			);
			expect(result.stderr).toContain(
				'Install worksheet dependencies in the build environment before rendering'
			);
			expect(result.stdout).not.toContain('MUST_NOT_RENDER_AFTER_MISSING_DEPENDENCY');
		} finally {
			rmSync(temporary, { recursive: true, force: true });
		}
	}
);

test.skipIf(!available)(
	'package setup without names or with an archive URL fails before interactive selection or downloading',
	() => {
		for (const setup of [
			'install.packages()',
			'install.packages("https://example.invalid/package.tar.gz")'
		]) {
			const { temporary, result } = knit(setup);
			try {
				expect(result.error).toBeUndefined();
				expect(result.status).not.toBe(0);
				expect(result.stderr).toContain('requires names of preinstalled R packages');
			} finally {
				rmSync(temporary, { recursive: true, force: true });
			}
		}
	}
);
