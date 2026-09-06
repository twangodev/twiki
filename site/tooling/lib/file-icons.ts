import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateManifest } from 'material-icon-theme';
import type { Manifest } from 'material-icon-theme';
import type { FileIconTheme, IconVariants, FolderIconVariants } from '../../src/lib/file-icons';

const manifest = generateManifest();

function association(
	key: string,
	base?: Record<string, string>,
	override?: Record<string, string>
) {
	if (override && Object.hasOwn(override, key)) return override[key];
	if (base && Object.hasOwn(base, key)) return base[key];
}

export function resolveIcon(name: string, folder = false, expanded = false, light = false) {
	const key = name.toLowerCase();
	const variant: Manifest = light ? (manifest.light ?? {}) : {};
	if (folder) {
		return expanded
			? (association(key, manifest.folderNamesExpanded, variant.folderNamesExpanded) ??
					variant.folderExpanded ??
					manifest.folderExpanded!)
			: (association(key, manifest.folderNames, variant.folderNames) ??
					variant.folder ??
					manifest.folder!);
	}
	const named = association(key, manifest.fileNames, variant.fileNames);
	if (named) return named;
	const parts = key.split('.');
	for (let i = 1; i < parts.length; i++) {
		const extension = association(
			parts.slice(i).join('.'),
			manifest.fileExtensions,
			variant.fileExtensions
		);
		if (extension) return extension;
	}
	return variant.file ?? manifest.file!;
}

export function buildFileIcons(siteDir: string, files: string[]) {
	const output = path.join(siteDir, '.generated/assets/_files/icons');
	const moduleDir = path.join(siteDir, 'src/lib/generated');
	const packageDir = path.dirname(
		fileURLToPath(import.meta.resolve('material-icon-theme/package.json'))
	);
	const used = new Set<string>();
	function variants(name: string, folder = false, expanded = false): IconVariants {
		const light = resolveIcon(name, folder, expanded, true);
		const dark = resolveIcon(name, folder, expanded);
		used.add(light);
		used.add(dark);
		return { light, dark };
	}
	function folderVariants(name: string): FolderIconVariants {
		return { ...variants(name, true), expanded: variants(name, true, true) };
	}
	const theme: FileIconTheme = {
		file: variants(''),
		folder: folderVariants(''),
		files: Object.create(null),
		folders: Object.create(null)
	};
	for (const file of files) {
		const parts = file.toLowerCase().split('/');
		const name = parts.pop()!;
		theme.files[name] ??= variants(name);
		for (const folder of parts) theme.folders[folder] ??= folderVariants(folder);
	}
	mkdirSync(output, { recursive: true });
	mkdirSync(moduleDir, { recursive: true });
	for (const icon of used) {
		const source = path.basename(manifest.iconDefinitions![icon].iconPath);
		copyFileSync(path.join(packageDir, 'icons', source), path.join(output, `${icon}.svg`));
	}
	copyFileSync(path.join(packageDir, 'LICENSE'), path.join(output, 'LICENSE.txt'));
	writeFileSync(path.join(moduleDir, 'file-icons.json'), JSON.stringify(theme));
	console.log(`icons: ${used.size} local file and folder icons`);
}
