import { readFileSync } from 'node:fs';
import { createFileHistoryBuilder } from './file-history';
import { browsablePath, fileHistoryPolicyKey } from './course-files';
import type { CourseFile } from '../../src/lib/files';

const job: {
	repo: string;
	output: string;
	cache: string;
	files: { file: CourseFile; source: string }[];
} = JSON.parse(readFileSync(0, 'utf8'));
const outputs = new Set<string>();
const build = createFileHistoryBuilder(
	job.repo,
	job.output,
	job.cache,
	browsablePath,
	fileHistoryPolicyKey(),
	(file) => outputs.add(file)
);
const histories = job.files.map(({ file, source }) => build?.(file, readFileSync(source)) ?? null);
process.stdout.write(JSON.stringify({ histories, outputs: [...outputs] }));
