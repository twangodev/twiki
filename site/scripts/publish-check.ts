import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { coursePolicies, publicationDecision } from '../tooling/lib/publishing';

const repo = path.resolve(import.meta.dir, '../..');
const policies = coursePolicies(repo);
const files = execFileSync(
	'git',
	['-C', repo, 'ls-files', '-z', '--recurse-submodules', '--', 'content'],
	{ maxBuffer: 1 << 28 }
)
	.toString()
	.split('\0')
	.filter(Boolean);
const requested = process.argv[2]?.replace(/^content\//, '');
let count = 0;
for (const tracked of files) {
	const relative = tracked.slice(8);
	if (requested && relative !== requested && !relative.startsWith(requested + '/')) continue;
	const [course, ...segments] = relative.split('/');
	const decision = publicationDecision(segments.join('/'), policies.get(course));
	if (decision.public) count++;
	if (requested || decision.public)
		console.log(`${decision.public ? 'PUBLIC ' : 'PRIVATE'} ${relative} — ${decision.reason}`);
}
console.log(
	`${count} files selected for publication; normal content and file safety filters still apply.`
);
