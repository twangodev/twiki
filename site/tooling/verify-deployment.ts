import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface Descriptor {
	schemaVersion: number;
	applicationVersion: string;
	snapshots: { public: string; full: string };
}

export function matchesDeployment(response: Response, descriptor: Descriptor) {
	return (
		response.status === 200 &&
		response.headers.get('content-type')?.includes('text/html') === true &&
		response.headers.get('x-wisconsin-content-version') === descriptor.snapshots.public &&
		response.headers.get('x-wisconsin-application-version') === descriptor.applicationVersion
	);
}

if (import.meta.main) {
	const descriptor = JSON.parse(
		readFileSync('build/.svelte-kit/cloudflare/_content/current.json', 'utf8')
	) as Descriptor;
	if (
		descriptor.schemaVersion !== 1 ||
		![descriptor.applicationVersion, descriptor.snapshots.public, descriptor.snapshots.full].every(
			(value) => /^[a-f0-9]{64}$/.test(value)
		)
	)
		throw new Error('Invalid local deployment descriptor');
	const origin = new URL(process.env.DEPLOYMENT_ORIGIN ?? 'https://wisconsin.twango.dev');
	if (origin.protocol !== 'https:' && origin.hostname !== '127.0.0.1')
		throw new Error('Deployment verification requires HTTPS');
	const started = Date.now();
	const deadline = started + 45_000;
	let verified = false;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(origin, {
				redirect: 'manual',
				headers: { 'cache-control': 'no-cache' },
				signal: AbortSignal.timeout(5_000)
			});
			const body = await response.text();
			if (
				matchesDeployment(response, descriptor) &&
				(!process.env.DEPLOYMENT_EXPECTED_TEXT ||
					body.includes(process.env.DEPLOYMENT_EXPECTED_TEXT))
			) {
				verified = true;
				break;
			}
		} catch {}
		await Bun.sleep(500);
	}
	if (!verified) throw new Error('The expected application/content version was not verified live');
	const acceptedAt = Date.now();
	let deploymentStarted = Number(process.env.DEPLOYMENT_STARTED_AT);
	let timingSource = 'first-workflow-step';
	// Job started_at includes runner setup; workflow creation time also includes
	// queueing, so it is unsuitable for the agreed deployment measurement.
	if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID) {
		try {
			const jobs = await fetch(
				`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT ?? '1'}/jobs?per_page=100`,
				{
					headers: {
						Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
						Accept: 'application/vnd.github+json'
					},
					signal: AbortSignal.timeout(5_000)
				}
			);
			if (jobs.ok) {
				const value = (await jobs.json()) as { jobs?: { name: string; started_at: string }[] };
				const selected = value.jobs?.find((job) => job.name === process.env.GITHUB_JOB);
				const timestamp = selected && Date.parse(selected.started_at);
				if (timestamp && Number.isFinite(timestamp)) {
					deploymentStarted = timestamp;
					timingSource = 'github-job-started-at';
				}
			}
		} catch {
			/* Preserve an explicitly labeled first-step measurement. */
		}
	}
	const report = {
		verified: true,
		timingSource,
		verificationSeconds: (acceptedAt - started) / 1_000,
		deploymentSeconds:
			Number.isFinite(deploymentStarted) && deploymentStarted > 0
				? (acceptedAt - deploymentStarted) / 1_000
				: null,
		applicationVersion: descriptor.applicationVersion,
		publicSnapshot: descriptor.snapshots.public
	};
	mkdirSync('build/benchmarks', { recursive: true });
	writeFileSync(
		path.join('build/benchmarks', 'deployment.json'),
		JSON.stringify(report, null, 2) + '\n'
	);
	console.log(JSON.stringify(report));
	if (process.env.GITHUB_STEP_SUMMARY)
		appendFileSync(
			process.env.GITHUB_STEP_SUMMARY,
			`### Verified deployment\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`
		);
}
