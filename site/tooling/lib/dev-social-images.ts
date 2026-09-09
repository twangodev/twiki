import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ContentManifest } from '../../src/lib/types';
import { socialImagePath } from '../../src/lib/social-image';
import { cachedSocialImage, defaultSocialCard, socialCard } from './social-images';

export async function serveDevSocialImage(
	request: IncomingMessage,
	response: ServerResponse,
	site: string
) {
	const url = new URL(request.url ?? '/', 'http://localhost');
	if (!url.pathname.startsWith('/_og/')) return false;
	response.setHeader('Cache-Control', 'no-store');
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		response.statusCode = 405;
		response.end();
		return true;
	}
	const manifest: ContentManifest = JSON.parse(
		readFileSync(path.join(site, 'build/generated/content-manifest.json'), 'utf8')
	);
	const page = Object.values(manifest.pages).find(
		(page) => socialImagePath(page.slug) === url.pathname
	);
	const card =
		url.pathname === socialImagePath() ? defaultSocialCard : page ? socialCard(page) : undefined;
	if (!card) {
		response.statusCode = 404;
		response.end();
		return true;
	}
	const { cached } = await cachedSocialImage(site, card);
	response.setHeader('Content-Type', 'image/png');
	response.end(request.method === 'HEAD' ? undefined : readFileSync(cached));
	return true;
}
