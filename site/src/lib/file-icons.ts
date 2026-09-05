export interface IconVariants {
	light: string;
	dark: string;
}

export interface FolderIconVariants extends IconVariants {
	expanded: IconVariants;
}

export interface FileIconTheme {
	file: IconVariants;
	folder: FolderIconVariants;
	files: Record<string, IconVariants>;
	folders: Record<string, FolderIconVariants>;
}

export function selectFileIcon(
	theme: FileIconTheme,
	name: string,
	folder = false,
	expanded = false
): IconVariants {
	const key = name.toLowerCase();
	if (!folder) return Object.hasOwn(theme.files, key) ? theme.files[key] : theme.file;
	const icon = Object.hasOwn(theme.folders, key) ? theme.folders[key] : theme.folder;
	return expanded ? icon.expanded : icon;
}
