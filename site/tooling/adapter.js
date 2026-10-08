import cloudflare from '@sveltejs/adapter-cloudflare';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prepareWranglerPaths } from './wrangler-paths.js';
import { indexSearch } from './search.js';
import { prewarmCloudflareEmulator } from './lib/cloudflare-prewarm.js';

export default function () {
	const directory = prepareWranglerPaths(path.resolve(import.meta.dirname, '..'));
	process.env.WRANGLER_CACHE_DIR ??= path.join(directory, 'cache');
	const adapter = cloudflare({
		platformProxy: { persist: { path: path.join(directory, 'state/v3') } }
	});
	return {
		...adapter,
		async emulate() {
			return prewarmCloudflareEmulator((await adapter.emulate?.()) ?? {});
		},
		/** @param {import('@sveltejs/kit').Builder} builder */
		async adapt(builder) {
			const started = performance.now();
			await adapter.adapt(builder);
			console.log(`adapter: cloudflare in ${((performance.now() - started) / 1000).toFixed(2)}s`);
			if (process.env.VITE_STATIC_EXPORT === 'true') {
				await indexSearch(builder.getBuildDirectory('cloudflare'));
				const shell = path.join(builder.getBuildDirectory('cloudflare'), '_file-browser.html');
				const fallbackStarted = performance.now();
				await builder.generateFallback(shell);
				console.log(
					`adapter: file browser shell in ${((performance.now() - fallbackStarted) / 1000).toFixed(2)}s`
				);
				writeFileSync(
					shell,
					readFileSync(shell, 'utf8').replace(
						'</body>',
						'<noscript><p>Enable JavaScript to use the file browser.</p></noscript></body>'
					)
				);
				if (process.env.VITE_PUBLIC_EDITION === 'true') {
					writeFileSync(
						'build/generated/public-routes.json',
						JSON.stringify(
							Object.fromEntries(
								[...builder.prerendered.pages].map(([route, page]) => [route, page.file])
							)
						)
					);
				}
			}
			const directory = builder.getBuildDirectory('');
			renameSync(`${directory}/worker.js`, `${directory}/svelte-worker.js`);
			writeFileSync(`${directory}/worker.js`, "export { default } from '../../worker/index.ts';\n");
		}
	};
}
