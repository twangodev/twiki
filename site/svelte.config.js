import adapter from './tooling/adapter.js';
import { readFileSync } from 'node:fs';

/** @param {string} filename @param {string} value */
function expectedDiagnostic(filename, value) {
	try {
		return JSON.parse(readFileSync(`.generated/${filename}.json`, 'utf8')).includes(value);
	} catch {
		return false;
	}
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode everywhere except libraries.
		runes: ({ filename }) => {
			if (filename.split(/[/\\]/).includes('node_modules')) return undefined;
			return true;
		}
	},
	kit: {
		adapter: adapter(),
		prerender: {
			origin: 'https://wisconsin.twango.dev',
			handleUnseenRoutes: ({ routes, message }) => {
				if (
					process.env.VITE_PUBLIC_EDITION === 'true' &&
					routes.every((route) => ['/tags/[...tag]', '/[course]/files/[...file]'].includes(route))
				)
					return;
				throw new Error(message);
			},
			handleHttpError: ({ status, path, referrer, message }) => {
				if (status === 404 && path === '/login') return;
				if (status === 404 && expectedDiagnostic('expected-404', path)) {
					console.warn(`[prerender] unresolved content link: ${path} <- ${referrer}`);
					return;
				}
				throw new Error(message);
			},
			handleMissingId: ({ path, id, referrers, message }) => {
				if (expectedDiagnostic('expected-missing-id', `${path}#${id}`)) {
					console.warn(
						`[prerender] unresolved content anchor: ${path}#${id} <- ${referrers.join(', ')}`
					);
					return;
				}
				throw new Error(message);
			}
		}
	}
};

export default config;
