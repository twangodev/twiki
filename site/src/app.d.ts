import type { AuthEnv } from '../worker/auth';

declare global {
	namespace App {
		interface Platform {
			env: AuthEnv & {
				WISCONSIN_CONTENT_CONTEXT?: import('./lib/server/content-provider').ContentContext;
				ASSETS: { fetch(request: Request): Promise<Response> };
			};
		}
	}
}

export {};
