import type { Plugin } from 'vite';

/** Keep root-mounted SSR client assets absolute without enabling mutable relative SSR paths. */
export function applicationAssetUrls(
	staticExport = process.env.VITE_STATIC_EXPORT === 'true'
): Plugin {
	return {
		name: 'wisconsin:application-asset-urls',
		enforce: 'post',
		config(config) {
			if (staticExport) return;
			const renderBuiltUrl = config.experimental?.renderBuiltUrl;
			return {
				experimental: {
					renderBuiltUrl(filename, details) {
						// Kit 2.65 forces Vite's base to './'. With paths.relative=false,
						// its {relative:false} result becomes './_app/...' even though Vite
						// resolves preload dependencies against the importing module URL.
						// The documented renderBuiltUrl hook can emit the correct root URL.
						if (!details.ssr && details.hostType === 'js') return `/${filename}`;
						return renderBuiltUrl?.(filename, details);
					}
				}
			};
		}
	};
}
