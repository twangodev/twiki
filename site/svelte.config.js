import site from './src/lib/site-config.json' with { type: 'json' };
import { staticDirectory } from './tooling/lib/edition-paths.js';
import adapter from './tooling/adapter.js';
import { readFileSync } from 'node:fs';
import { applicationVersion } from './tooling/lib/app-version.js';
import { emptyTagRoute } from './tooling/lib/empty-tag-route.js';

const prerenderConcurrency = Number(process.env.PRERENDER_CONCURRENCY ?? 1);
if (!Number.isInteger(prerenderConcurrency) || prerenderConcurrency < 1)
	throw new Error('PRERENDER_CONCURRENCY must be a positive integer');

/** @param {string} filename @param {string} value */
function expectedDiagnostic(filename, value) {
	try {
		return JSON.parse(readFileSync(`build/generated/${filename}.json`, 'utf8')).includes(value);
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
		paths: { relative: process.env.VITE_STATIC_EXPORT === 'true' },
		outDir: 'build/.svelte-kit',
		files: { assets: process.env.TWIKI_APP_STATIC_DIR ?? staticDirectory(process.cwd()) },
		adapter: adapter(),
		// Content is served separately. Rebuilding it should not change the
		// application version, hydration IDs, and every prerendered HTML asset.
		version: { name: applicationVersion(process.cwd()) },
		prerender: {
			concurrency: prerenderConcurrency,
			origin: site.url,
			handleUnseenRoutes: ({ routes, message }) => {
				if (emptyTagRoute(process.cwd(), routes)) return;
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
