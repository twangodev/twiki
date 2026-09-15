import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { content } from './tooling/vite-content';

export default defineConfig({
	plugins: [content(), tailwindcss(), sveltekit()],
	// The file viewer imports WebR lazily. Discover it at startup so opening
	// a file does not trigger dependency optimization and reset the page.
	optimizeDeps: { include: ['webr'] },
	server: {
		watch: {
			ignored: ['**/site/build/**']
		}
	}
});
