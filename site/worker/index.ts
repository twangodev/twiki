// @ts-expect-error The adapter generates this untyped module during build.
import app from '../.svelte-kit/svelte-worker.js';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { authenticateRequest } from './gate';
import type { AuthEnv } from './auth';

interface Env extends AuthEnv {
	ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		return authenticateRequest(request, env, async () => {
			if (request.method === 'GET' || request.method === 'HEAD') {
				const asset = await env.ASSETS.fetch(request);
				if (asset.status !== 404) return asset;
			}
			return app.fetch(request, env, ctx);
		});
	}
};
