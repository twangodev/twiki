import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { CourseFile, RmdPreview } from '../../src/lib/files';

const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export type RmdPreviewInputs = {
	runtime: string;
	policy: string;
	course: string;
	inputs: string;
	worksheet: string;
};
export type RmdPreviewResult = { preview: string; blobs: string[] };

export function rmdCourseInputs(files: CourseFile[]) {
	return JSON.stringify({
		available: files
			.filter((file) => !file.locked && file.download)
			.map(({ path, download }) => [path, download])
			.sort(),
		// parseRmd also resolves links and embeds against locked or oversized entries.
		// Preserve catalog order, which determines the first exact matching candidate.
		catalog: files.map((file) => [
			file.path,
			file.kind === 'image',
			Boolean(file.locked),
			file.note ?? null,
			file.download ?? null
		])
	});
}

export function rmdPreviewKey(inputs: RmdPreviewInputs) {
	return sha256(
		`${inputs.runtime}\n${inputs.policy}\n${inputs.course}\n${inputs.inputs}\n${inputs.worksheet}`
	);
}

export function rmdPreviewRecord(inputs: RmdPreviewInputs, result: RmdPreviewResult) {
	return { schemaVersion: 2, ...inputs, ...result };
}

/** Validate actual immutable bytes, not only existence or restored file timestamps. */
export function readRmdPreviewResult(
	site: string,
	inputs: RmdPreviewInputs
): RmdPreviewResult | undefined {
	try {
		if (!/\nfontconfig-v1:[a-f0-9]{64}$/.test(inputs.runtime)) return;
		const directory = path.resolve(site, 'build/generated/cache/rmd', rmdPreviewKey(inputs));
		if (realpathSync(directory) !== directory) return;
		const read = (name: string) => {
			const file = path.join(directory, name);
			if (!lstatSync(file).isFile() || realpathSync(file) !== file)
				throw new Error('Unsafe R preview cache file');
			const info = lstatSync(file);
			if (info.size > 25 * 1024 * 1024) throw new Error('Oversized R preview cache file');
			return readFileSync(file);
		};
		const saved = JSON.parse(read('result.json').toString());
		if (
			saved.schemaVersion !== 2 ||
			Object.entries(inputs).some(([name, value]) => saved[name] !== value) ||
			!Array.isArray(saved.blobs) ||
			!saved.blobs.length ||
			saved.blobs.length > 1024 ||
			typeof saved.preview !== 'string' ||
			!saved.blobs.includes(saved.preview) ||
			new Set(saved.blobs).size !== saved.blobs.length
		)
			return;
		for (const blob of saved.blobs) {
			if (typeof blob !== 'string' || !/^[a-f0-9]{64}\.(?:json|png|jpg|jpeg|svg|pdf)$/.test(blob))
				return;
			if (sha256(read(blob)) !== blob.slice(0, 64)) return;
		}
		if (!saved.preview.endsWith('.json')) return;
		const preview: RmdPreview = JSON.parse(read(saved.preview).toString());
		if (typeof preview.title !== 'string' || typeof preview.html !== 'string') return;
		const downloads = new Set<string>();
		for (const [, download] of JSON.parse(inputs.inputs).available) {
			if (typeof download === 'string' && /^\/_files\/blobs\/[a-f0-9]{64}\.[a-z]+$/.test(download))
				downloads.add(path.basename(download));
		}
		for (const match of preview.html.matchAll(/\/_files\/blobs\/([a-f0-9]{64}\.[a-z]+)/g)) {
			if (!saved.blobs.includes(match[1]) && !downloads.has(match[1])) return;
		}
		return { preview: saved.preview, blobs: saved.blobs };
	} catch {
		return;
	}
}
