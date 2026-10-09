import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { content } from './tooling/vite-content';
import { applicationAssetUrls } from './tooling/lib/application-asset-urls';

const dependencyPaths: unknown = JSON.parse(process.env.TWIKI_DEPENDENCY_PATHS ?? '[]');
if (
	!Array.isArray(dependencyPaths) ||
	!dependencyPaths.every(
		(value): value is string =>
			typeof value === 'string' && isAbsolute(value) && statSync(value).isDirectory()
	)
)
	throw new Error('TWIKI_DEPENDENCY_PATHS must contain absolute dependency directories');

export default defineConfig({
	plugins: [content(), tailwindcss(), sveltekit(), applicationAssetUrls()],
	// The file viewer imports WebR lazily. Discover it at startup so opening
	// a file does not trigger dependency optimization and reset the page.
	optimizeDeps: { include: ['webr'] },
	// Gzip size reporting recompresses bundles solely for the build log.
	build: { reportCompressedSize: false },
	server: {
		// CLI staging keeps dependencies in the installed package, outside the consumer runtime.
		// Preserve Vite's workspace boundary and allow only that resolved dependency tree.
		fs: {
			allow: [
				searchForWorkspaceRoot(process.cwd()),
				...dependencyPaths,
				...(process.env.TWIKI_DEPENDENCY_DIR ? [process.env.TWIKI_DEPENDENCY_DIR] : [])
			]
		},
		watch: {
			ignored: ['**/site/build/**']
		}
	}
});
