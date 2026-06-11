import adapter from '@sveltejs/adapter-cloudflare';
import { readFileSync } from 'node:fs';

/**
 * Internal hrefs that 404 by design: bug-for-bug parity with links that are
 * broken on the live Quartz site too (golden-diff link parity is 100%; see
 * .generated/warnings.txt "broken link (also broken on live site)").
 * Emitted by scripts/prepare-static.ts; any 404 NOT in this list fails the
 * build, which keeps the prerender crawl working as broken-link CI.
 */
let expected404 = new Set();
try {
	expected404 = new Set(JSON.parse(readFileSync('.generated/expected-404.json', 'utf-8')));
} catch {
	// No prebuild output yet (e.g. fresh checkout running `svelte-kit sync`).
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
			handleHttpError: ({ status, path, referrer, message }) => {
				if (status === 404 && expected404.has(path)) {
					console.warn(
						`[prerender] expected 404 (broken on live site too): ${path} <- ${referrer}`
					);
					return;
				}
				throw new Error(message);
			},
			// TODO(Verify phase): escalate to 'error' once in-content anchor ids
			// are confirmed clean across the corpus.
			handleMissingId: 'warn'
		}
	}
};

export default config;
