import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CourseFile } from '../../src/lib/files';
import { assetLimit, browsablePath, fileHistoryPolicyKey } from './course-files';
import { createFileHistoryBuilder } from './file-history';
import { parseGitmodules } from './lastmod';

const assetPrefix = '/__content/history-assets';

/** Dev-only: create history when its panel is opened, outside the generated static tree. */
export function serveDevHistory(
	request: IncomingMessage,
	response: ServerResponse,
	site: string,
	repo: string
) {
	const url = new URL(request.url ?? '/', 'http://localhost');
	if (url.pathname !== '/__content/history' && !url.pathname.startsWith(assetPrefix + '/'))
		return false;
	response.setHeader('Cache-Control', 'no-store');
	if (process.env.VITE_PUBLIC_EDITION === 'true') {
		response.statusCode = 404;
		response.end();
		return true;
	}
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		response.statusCode = 405;
		response.end();
		return true;
	}
	const output = path.join(site, 'build/generated/dev-history');
	try {
		let target: string;
		if (url.pathname.startsWith(assetPrefix + '/')) {
			const name = url.pathname.slice(assetPrefix.length + 1);
			if (!/^[a-f0-9]{64}(?:-(?:blame|[a-f0-9]{40,64}))?\.(?:json|diff)$/.test(name))
				throw new Error('Not found');
			target = path.join(output, 'history', name);
		} else {
			const course = url.searchParams.get('course') ?? '';
			const file = url.searchParams.get('file') ?? '';
			const module = parseGitmodules(path.join(repo, '.gitmodules')).find(
				(entry) => entry.path === `content/${course}`
			);
			if (!module || !/^[\w-]+$/.test(course) || !browsablePath(file)) throw new Error('Not found');
			const index: CourseFile[] = JSON.parse(
				readFileSync(
					path.join(site, 'build/generated/assets/_files/index', `${course}.json`),
					'utf8'
				)
			);
			const entry = index.find(
				(entry) =>
					entry.path === file && !entry.locked && entry.history?.startsWith('/__content/history?')
			);
			if (!entry) throw new Error('Not found');
			const source = path.join(module.fullPath, file);
			if (realpathSync(source) !== source) throw new Error('Not found');
			const bytes = readFileSync(source);
			if (bytes.length > assetLimit) throw new Error('Not found');
			const build = createFileHistoryBuilder(
				module.fullPath,
				output,
				path.join(site, 'build/generated/cache/file-history', course),
				browsablePath,
				fileHistoryPolicyKey(),
				undefined,
				assetPrefix
			);
			const asset = build?.(entry, bytes);
			if (!asset) throw new Error('Not found');
			target = path.join(output, 'history', path.basename(asset));
		}
		if (!existsSync(target)) throw new Error('Not found');
		response.setHeader(
			'Content-Type',
			target.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8'
		);
		response.end(request.method === 'HEAD' ? undefined : readFileSync(target));
	} catch {
		response.statusCode = 404;
		response.end('History unavailable');
	}
	return true;
}
