import type { AuthEnv } from '../worker/auth';

declare global {
	namespace App {
		interface Platform {
			env: AuthEnv & { ASSETS: { fetch(request: Request): Promise<Response> } };
		}
	}
}

export {};
