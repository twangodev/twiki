import { expect, test } from 'bun:test';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { buildMode, runEditionBuilds } from '../../tooling/lib/edition-builds';

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function waitFor(file: string) {
	const deadline = Date.now() + 3_000;
	while (!existsSync(file)) {
		if (Date.now() > deadline) throw new Error(`Stub did not create ${path.basename(file)}`);
		await pause(10);
	}
}

function fixture(scenario: string) {
	const root = mkdtempSync(path.join(tmpdir(), 'wisconsin-edition-builds-'));
	const publicSite = path.join(root, 'public');
	const fullSite = path.join(root, 'full');
	for (const directory of [publicSite, fullSite]) mkdirSync(directory);
	const command = path.join(root, 'child.ts');
	writeFileSync(
		command,
		`
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
const [scenario, shared] = process.argv.slice(2);
const edition = process.env.VITE_PUBLIC_EDITION === 'true' ? 'public' : 'full';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async file => {
 const deadline = Date.now() + 2500;
 while (!existsSync(path.join(shared, file))) {
  if (Date.now() > deadline) process.exit(9);
  await pause(10);
 }
};
writeFileSync(path.join(shared, edition + '-start'), JSON.stringify({
 pid: process.pid, cwd: process.cwd(), contentRepo: process.env.WISCONSIN_CONTENT_REPO,
 version: process.env.WISCONSIN_APPLICATION_VERSION, nodeEnv: process.env.NODE_ENV
}));
if (scenario === 'parallel') {
 await wait('public-start'); await wait('full-start');
} else if (scenario === 'serial' && edition === 'full') {
 if (!existsSync(path.join(shared, 'public-done'))) process.exit(10);
} else if (scenario === 'failure') {
 if (edition === 'full') {
  process.on('SIGTERM', () => {});
  const grandchild = path.join(shared, 'grandchild.ts');
  writeFileSync(grandchild, "import { writeFileSync } from 'node:fs'; process.on('SIGTERM',()=>{}); writeFileSync(process.argv[2], String(process.pid)); setInterval(()=>{},1000);");
  spawn(process.execPath, [grandchild, path.join(shared, 'grandchild-pid')], { stdio: 'ignore' });
  setInterval(() => {}, 1000);
  await new Promise(() => {});
 } else {
  await wait('grandchild-pid'); process.exit(13);
 }
} else if (scenario === 'abort') {
 process.on('SIGTERM', () => {});
 setInterval(() => {}, 1000);
 await new Promise(() => {});
}
console.log('parse: 7 pages in 1ms (7 cached, 0 parsed)');
console.error('diagnostic from ' + edition);
writeFileSync(path.join(shared, edition + '-done'), 'done');
`
	);
	const options = {
		mode: (scenario === 'serial' ? 'isolated-serial' : 'parallel') as
			| 'isolated-serial'
			| 'parallel',
		contentRepo: path.join(root, 'content-repo'),
		applicationVersion: 'a'.repeat(64),
		logDirectory: path.join(root, 'logs'),
		command: process.execPath,
		args: [command, scenario, root],
		killGraceMs: 100,
		log: () => {}
	};
	return { root, publicSite, fullSite, options };
}

function running(pid: number) {
	try {
		process.kill(pid, 0);
		// A killed orphan can briefly wait for the system init process to reap it.
		if (
			process.platform === 'linux' &&
			readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].startsWith('Z')
		)
			return false;
		return true;
	} catch (error) {
		if (
			(error as NodeJS.ErrnoException).code === 'ESRCH' ||
			(error as NodeJS.ErrnoException).code === 'ENOENT'
		)
			return false;
		throw error;
	}
}

test('unknown build modes fail before starting work', () => {
	expect(buildMode('serial')).toBe('serial');
	expect(buildMode('parallel')).toBe('parallel');
	expect(buildMode('isolated-serial')).toBe('isolated-serial');
	expect(() => buildMode('typo')).toThrow('WISCONSIN_BUILD_MODE');
	expect(() => buildMode('')).toThrow('WISCONSIN_BUILD_MODE');
});

test.each(['unset', 'development'])(
	'edition runtime uses production by default and respects NODE_ENV=%s',
	async (selection) => {
		const fixtureData = fixture('serial');
		const previous = process.env.NODE_ENV;
		try {
			if (selection === 'unset') delete process.env.NODE_ENV;
			else process.env.NODE_ENV = selection;
			await runEditionBuilds(fixtureData, fixtureData.options);
			for (const edition of ['public', 'full']) {
				const started = JSON.parse(
					readFileSync(path.join(fixtureData.root, `${edition}-start`), 'utf8')
				);
				expect(started.nodeEnv).toBe(selection === 'unset' ? 'production' : selection);
			}
		} finally {
			if (previous === undefined) delete process.env.NODE_ENV;
			else process.env.NODE_ENV = previous;
			rmSync(fixtureData.root, { recursive: true, force: true });
		}
	}
);

test.each(['parallel', 'serial'])(
	'%s launches isolated editions with explicit inputs and private raw logs',
	async (scenario) => {
		const fixtureData = fixture(scenario);
		try {
			const result = await runEditionBuilds(fixtureData, fixtureData.options);
			expect(result.publicSeconds).toBeGreaterThan(0);
			expect(result.fullSeconds).toBeGreaterThan(0);
			for (const edition of ['public', 'full']) {
				const started = JSON.parse(
					readFileSync(path.join(fixtureData.root, `${edition}-start`), 'utf8')
				);
				expect(started.cwd).toBe(
					edition === 'public' ? fixtureData.publicSite : fixtureData.fullSite
				);
				expect(started.contentRepo).toBe(fixtureData.options.contentRepo);
				expect(started.version).toBe(fixtureData.options.applicationVersion);
				const logfile = path.join(fixtureData.options.logDirectory, `${edition}.log`);
				expect(readFileSync(logfile, 'utf8')).toContain(
					'parse: 7 pages in 1ms (7 cached, 0 parsed)'
				);
				expect(readFileSync(logfile, 'utf8')).toContain(`diagnostic from ${edition}`);
				expect(statSync(logfile).mode & 0o777).toBe(0o600);
				expect(running(started.pid)).toBeFalse();
			}
		} finally {
			rmSync(fixtureData.root, { recursive: true, force: true });
		}
	}
);

test('one failed edition kills a stubborn sibling and descendant before cleanup', async () => {
	const fixtureData = fixture('failure');
	try {
		await expect(runEditionBuilds(fixtureData, fixtureData.options)).rejects.toThrow(
			'public build failed (exit 13)'
		);
		const full = JSON.parse(readFileSync(path.join(fixtureData.root, 'full-start'), 'utf8'));
		const descendant = Number(readFileSync(path.join(fixtureData.root, 'grandchild-pid'), 'utf8'));
		expect(running(full.pid)).toBeFalse();
		expect(running(descendant)).toBeFalse();
		expect(existsSync(path.join(fixtureData.root, 'full-done'))).toBeFalse();
		// Returning from the runner is the point at which orchestration may remove its snapshot.
		rmSync(fixtureData.fullSite, { recursive: true });
		expect(existsSync(fixtureData.fullSite)).toBeFalse();
	} finally {
		rmSync(fixtureData.root, { recursive: true, force: true });
	}
});

test('abort waits for both stubborn children; pre-abort starts neither edition', async () => {
	const fixtureData = fixture('abort');
	const controller = new AbortController();
	try {
		const result = runEditionBuilds(fixtureData, {
			...fixtureData.options,
			signal: controller.signal
		});
		const rejected = result.catch((error: Error) => error);
		await waitFor(path.join(fixtureData.root, 'public-start'));
		await waitFor(path.join(fixtureData.root, 'full-start'));
		controller.abort();
		expect(await rejected).toBeInstanceOf(Error);
		expect(((await rejected) as Error).message).toBe('Edition builds aborted');
		for (const edition of ['public', 'full']) {
			const started = JSON.parse(
				readFileSync(path.join(fixtureData.root, `${edition}-start`), 'utf8')
			);
			expect(running(started.pid)).toBeFalse();
		}
		await expect(
			runEditionBuilds(fixtureData, { ...fixtureData.options, signal: controller.signal })
		).rejects.toThrow('Edition builds aborted');
	} finally {
		rmSync(fixtureData.root, { recursive: true, force: true });
	}
});

test('an executable spawn failure closes the other edition before returning', async () => {
	const fixtureData = fixture('parallel');
	try {
		await expect(
			runEditionBuilds(fixtureData, {
				...fixtureData.options,
				command: path.join(fixtureData.root, 'missing-command')
			})
		).rejects.toThrow('Could not start');
		expect(existsSync(path.join(fixtureData.root, 'public-start'))).toBeFalse();
		expect(existsSync(path.join(fixtureData.root, 'full-start'))).toBeFalse();
	} finally {
		rmSync(fixtureData.root, { recursive: true, force: true });
	}
});

test('SIGINT reaps both process groups before a caller removes the snapshots', async () => {
	const fixtureData = fixture('abort');
	const driver = path.join(fixtureData.root, 'driver.ts');
	writeFileSync(
		driver,
		`
import { rmSync, writeFileSync } from 'node:fs';
import { runEditionBuilds } from ${JSON.stringify(path.resolve(import.meta.dirname, '../../tooling/lib/edition-builds.ts'))};
const sites = ${JSON.stringify({ publicSite: fixtureData.publicSite, fullSite: fixtureData.fullSite })};
const options = ${JSON.stringify(fixtureData.options)};
try {
 await runEditionBuilds(sites, {...options, log: () => {}});
 process.exitCode = 1;
} catch(error) {
 writeFileSync(${JSON.stringify(path.join(fixtureData.root, 'interruption'))}, error.message);
} finally {
 rmSync(sites.publicSite, {recursive:true,force:true});
 rmSync(sites.fullSite, {recursive:true,force:true});
}
`
	);
	const child = spawn(process.execPath, [driver], { stdio: ['ignore', 'pipe', 'pipe'] });
	const completed = new Promise<number | null>((resolve, reject) => {
		child.on('error', reject);
		child.on('close', resolve);
	});
	try {
		await waitFor(path.join(fixtureData.root, 'public-start'));
		await waitFor(path.join(fixtureData.root, 'full-start'));
		child.kill('SIGINT');
		expect(await completed).toBe(0);
		expect(readFileSync(path.join(fixtureData.root, 'interruption'), 'utf8')).toContain(
			'interrupted by SIGINT'
		);
		for (const edition of ['public', 'full']) {
			const started = JSON.parse(
				readFileSync(path.join(fixtureData.root, `${edition}-start`), 'utf8')
			);
			expect(running(started.pid)).toBeFalse();
			expect(
				existsSync(edition === 'public' ? fixtureData.publicSite : fixtureData.fullSite)
			).toBeFalse();
		}
	} finally {
		if (child.exitCode === null) child.kill('SIGKILL');
		await completed;
		rmSync(fixtureData.root, { recursive: true, force: true });
	}
});
