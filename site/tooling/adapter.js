import cloudflare from '@sveltejs/adapter-cloudflare';
import { renameSync, writeFileSync } from 'node:fs';
import { indexSearch } from './search.js';

export default function () {
	const adapter = cloudflare();
	return {
		...adapter,
		/** @param {import('@sveltejs/kit').Builder} builder */
		async adapt(builder) {
			await adapter.adapt(builder);
			await indexSearch('.svelte-kit/cloudflare');
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
			const directory = builder.getBuildDirectory('');
			renameSync(`${directory}/worker.js`, `${directory}/svelte-worker.js`);
			writeFileSync(`${directory}/worker.js`, "export { default } from '../worker/index.ts';\n");
		}
	};
}
