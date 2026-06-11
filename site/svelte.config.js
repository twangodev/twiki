import adapter from '@sveltejs/adapter-cloudflare';

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
		adapter: adapter()
	}
};

export default config;
