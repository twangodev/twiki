import path from 'node:path';

// Content changes update these revalidated assets without renaming application
// chunks referenced by every prerendered page. Keep them outside _app/immutable.
export const runtimeDataAssets = {
	'nav.json': 'navigation.js',
	'file-icons.json': 'file-icons.js'
} as const;

export function runtimeDataModuleSource(data: unknown): string {
	// JSON.parse preserves own "__proto__" keys in filename/folder catalogs;
	// a JavaScript object literal would interpret those keys as prototype setters.
	return `export default JSON.parse(${JSON.stringify(JSON.stringify(data))});\n`;
}

export function resolveRuntimeDataImport(
	source: string,
	config: { root: string; command: 'build' | 'serve'; consumer?: 'client' | 'server' }
) {
	if (config.command !== 'build' || config.consumer !== 'client') return;
	// SSR and development retain the JSON import. Production browsers load exactly
	// the same edition-specific data through the authenticated asset routing layer.
	for (const [input, asset] of Object.entries(runtimeDataAssets)) {
		if (
			source === `$lib/generated/${input}` ||
			source === path.join(config.root, 'src/lib/generated', input)
		)
			return { id: `/${asset}`, external: 'absolute' as const };
	}
}
