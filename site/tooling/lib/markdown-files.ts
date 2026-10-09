import { execFileSync } from 'node:child_process';
import { lstatSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Include tracked and untracked, non-ignored Markdown, descending into submodules. */
export function markdownFiles(inputs: string[], extension = /\.md$/i): string[] {
	const files = new Set<string>();
	function collect(input: string) {
		const absolute = path.resolve(input);
		const stat = lstatSync(absolute);
		if (stat.isSymbolicLink()) return;
		if (stat.isFile()) {
			if (!extension.test(absolute)) throw new Error(`Expected Markdown: ${input}`);
			files.add(absolute);
			return;
		}
		let names: string[];
		try {
			names = execFileSync(
				'git',
				['-C', absolute, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
				{ encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
			).split('\0');
		} catch (error) {
			// A plain Obsidian folder is a supported source; permission failures remain errors.
			const detail = String((error as { stderr?: unknown }).stderr ?? '');
			if (!detail.includes('not a git repository')) throw error;
			for (const name of readdirSync(absolute)) {
				if (name.startsWith('.') || ['node_modules', 'build', 'dist'].includes(name)) continue;
				const full = path.join(absolute, name),
					entry = lstatSync(full);
				if (entry.isDirectory()) collect(full);
				else if (entry.isFile() && extension.test(name)) files.add(full);
			}
			return;
		}
		for (const name of new Set(names.filter(Boolean))) {
			const full = path.join(absolute, name);
			if (!existsSync(full)) continue; // tracked deletion in the working tree
			const entry = lstatSync(full);
			if (entry.isDirectory()) {
				if (!existsSync(path.join(full, '.git'))) {
					throw new Error(`Submodule is not initialized: ${full}`);
				}
				collect(full);
			} else if (entry.isFile() && extension.test(name)) files.add(full);
		}
	}
	inputs.forEach(collect);
	return [...files].sort();
}
