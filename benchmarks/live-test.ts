import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolveProject } from '../site/tooling/lib/project-config';
import { CloudflareDeploymentAPI } from '../site/tooling/lib/deployment-upload';

const mode = process.argv[2];
const project = resolveProject();
const origin = project.site.url;
const worker = project.cloudflare?.name;
const requestedPaths = process.env.TWIKI_LIVE_PATHS;
const testPaths: string[] = requestedPaths ? JSON.parse(requestedPaths) : ['/'];
if (
	!Array.isArray(testPaths) ||
	testPaths.some(
		(value) => typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')
	)
)
	throw new Error('TWIKI_LIVE_PATHS must be a JSON array of local URL paths');
const directory = 'build/benchmarks/live';
mkdirSync(directory, { recursive: true });
if (mode === 'capture' || mode === 'verify-rollback') {
	if (typeof worker !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(worker))
		throw new Error('Configure the Worker name before live capture');
	const account = process.env.CLOUDFLARE_ACCOUNT_ID;
	if (!account || !/^[a-f0-9]{32}$/.test(account)) throw new Error('Missing account identity');
	const api = new CloudflareDeploymentAPI(process.env.CLOUDFLARE_API_TOKEN ?? '');
	const result = (await api.request(
		`/accounts/${account}/workers/scripts/${worker}/deployments`
	)) as {
		deployments: { versions: { version_id: string; percentage: number }[] }[];
	};
	const versions = result.deployments[0]?.versions;
	if (
		versions?.length !== 1 ||
		versions[0].percentage !== 100 ||
		!/^[a-f0-9-]{36}$/.test(versions[0].version_id)
	)
		throw new Error('Expected one active version');
	const version = versions[0].version_id;
	if (mode === 'verify-rollback') {
		if (version !== process.env.ROLLBACK_VERSION) throw new Error('Rollback version is not active');
		const response = await fetch(origin, { signal: AbortSignal.timeout(10_000) });
		if (response.status !== 200 || (await response.text()).length < 1000)
			throw new Error('Rollback HTML unavailable');
		console.log(`Verified rollback: ${version}`);
		process.exit(0);
	}
	writeFileSync(`${directory}/rollback.json`, JSON.stringify({ version }, null, 2));
	appendFileSync(process.env.GITHUB_OUTPUT!, `version=${version}\n`);
	console.log(`Rollback version: ${version}`);
} else if (mode === 'baseline' || mode === 'measure') {
	const paths = testPaths;
	const reports = [];
	for (const pathname of paths) {
		const samples = [];
		for (let index = 0; index < 9; index++) {
			const started = performance.now();
			const response = await fetch(origin + pathname, {
				redirect: 'manual',
				signal: AbortSignal.timeout(10_000)
			});
			const headersMs = performance.now() - started;
			const body = await response.text();
			if (
				response.status !== 200 ||
				!response.headers.get('content-type')?.includes('text/html') ||
				body.length < 1000
			)
				throw new Error('Public HTML acceptance failed');
			if (mode === 'measure' && !response.headers.get('x-wisconsin-application-version'))
				throw new Error('SSR version header missing');
			samples.push({
				headersMs,
				totalMs: performance.now() - started,
				colo: response.headers.get('cf-ray')?.split('-').at(-1)
			});
		}
		const warm = samples
			.slice(1)
			.map((value) => value.headersMs)
			.sort((a, b) => a - b);
		reports.push({
			path: pathname,
			firstRequestMs: samples[0].headersMs,
			warmMedianMs: (warm[3] + warm[4]) / 2,
			samples
		});
	}
	writeFileSync(`${directory}/${mode}.json`, JSON.stringify(reports, null, 2));
	console.log(JSON.stringify({ mode, reports }));
	if (mode === 'measure') {
		const descriptor = JSON.parse(
			readFileSync('build/.svelte-kit/cloudflare/_content/current.json', 'utf8')
		);
		for (const pathname of [
			'/_content/current.json',
			`/_content/full/${descriptor.snapshots.full}/manifest.json`,
			'/_published/index.html'
		]) {
			const response = await fetch(origin + pathname, {
				redirect: 'manual',
				signal: AbortSignal.timeout(10_000)
			});
			await response.body?.cancel();
			if (![401, 403, 404].includes(response.status))
				throw new Error('Internal asset access was not denied');
		}
		for (const cookie of process.env.TWIKI_LIVE_PRIVATE_PATH
			? ['', 'better-auth.session_token=invalid']
			: []) {
			const privatePath = process.env.TWIKI_LIVE_PRIVATE_PATH!;
			if (!privatePath.startsWith('/') || privatePath.startsWith('//'))
				throw new Error('Invalid private test path');
			const response = await fetch(origin + privatePath, {
				headers: { cookie },
				signal: AbortSignal.timeout(10_000)
			});
			if (response.status !== 200 || !(await response.text()).includes('Content locked'))
				throw new Error('Private note did not render a locked preview');
		}
		const baseline = JSON.parse(
			readFileSync(`${directory}/baseline.json`, 'utf8')
		) as typeof reports;
		for (let i = 0; i < reports.length; i++) {
			if (
				reports[i].warmMedianMs > Math.max(500, baseline[i].warmMedianMs * 2) ||
				reports[i].firstRequestMs > 3000
			)
				throw new Error('Live response regression exceeded acceptance bounds');
		}
	}
	writeFileSync(`${directory}/${mode}.json`, JSON.stringify(reports, null, 2));
	console.log(JSON.stringify({ mode, reports }));
	if (process.env.GITHUB_STEP_SUMMARY)
		appendFileSync(
			process.env.GITHUB_STEP_SUMMARY,
			`### ${mode}\n\n\`\`\`json\n${JSON.stringify(reports, null, 2)}\n\`\`\`\n`
		);
} else throw new Error('Expected capture, baseline or measure');
