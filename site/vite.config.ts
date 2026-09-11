import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { content } from './tooling/vite-content';

export default defineConfig({
	plugins: [content(), tailwindcss(), sveltekit()],
	server: {
		watch: {
			ignored: ['**/site/build/**']
		}
	}
});
