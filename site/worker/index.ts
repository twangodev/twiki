// @ts-expect-error The adapter generates this untyped module during build.
import app from '../.svelte-kit/svelte-worker.js';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { authenticateRequest } from './gate';
import type { AuthEnv } from './auth';
import publicAssets from '../build/generated/public-assets.json';
import { publicTarget } from './publication';

interface Env extends AuthEnv {
	ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const servePublic = async () => {
			const target = publicTarget(request, publicAssets);
			if (!target) return null;
			const url = new URL(request.url);
			url.pathname = target;
			url.search = '';
			const response = await env.ASSETS.fetch(new Request(url, { method: request.method }));
			if (response.status >= 300 && response.status < 400)
				return new Response('Publication unavailable', { status: 503 });
			return response;
		};
		return authenticateRequest(
			request,
			env,
			async () => {
				if (request.method === 'GET' || request.method === 'HEAD') {
					const asset = await env.ASSETS.fetch(request);
					if (asset.status !== 404) return asset;
				}
				return app.fetch(request, env, ctx);
			},
			servePublic
		);
	}
};
