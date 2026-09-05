import cloudflare from '@sveltejs/adapter-cloudflare';
import { renameSync, writeFileSync } from 'node:fs';

export default function () {
	const adapter = cloudflare();
	return {
		...adapter,
		/** @param {import('@sveltejs/kit').Builder} builder */
		async adapt(builder) {
			await adapter.adapt(builder);
			const directory = builder.getBuildDirectory('');
			renameSync(`${directory}/worker.js`, `${directory}/svelte-worker.js`);
			writeFileSync(`${directory}/worker.js`, "export { default } from '../worker/index.ts';\n");
		}
	};
}
