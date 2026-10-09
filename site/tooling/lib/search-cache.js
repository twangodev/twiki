import { createHash } from 'node:crypto';
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import path from 'node:path';

/** @param {string | Uint8Array} bytes */
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The exact HTML/custom records, their submission order and Pagefind version
 * identify the complete index. Neither checkout paths nor filesystem timestamps
 * participate. Edition is explicit even when two tiny fixtures happen to match.
 * @param {{html: import('pagefind').HTMLFile[]; records: import('pagefind').CustomRecord[]; pagefindVersion: string; edition: string}} input
 */
export function searchInputKey(input) {
	return digest(JSON.stringify(['pagefind-inputs-v1', input]));
}

/** @param {string} file */
function safePath(file) {
	return (
		file.length < 1024 &&
		/^[\w.-]+(?:\/[\w.-]+)*$/.test(file) &&
		file.split('/').every((segment) => segment !== '.' && segment !== '..')
	);
}

/** @param {string} root */
function filesIn(root) {
	/** @type {string[]} */
	const files = [];
	/** @param {string} directory */
	function visit(directory) {
		for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
			const relative = directory ? `${directory}/${entry.name}` : entry.name;
			if (!safePath(relative)) throw new Error('Invalid Pagefind output path');
			if (entry.isDirectory()) visit(relative);
			else if (entry.isFile()) files.push(relative);
			else throw new Error('Pagefind output must contain regular files');
		}
	}
	visit('');
	return files.sort();
}

/** Copy a fully validated generation into a clean directory. Validate before
 * replacing any output so a corrupt/missing cache cannot leave a partial index.
 * @param {string} cache @param {string} output @param {string} key @param {string} edition
 */
export function restoreSearchCache(cache, output, key, edition) {
	/** @type {string | undefined} */
	let temporary;
	try {
		const root = realpathSync(cache);
		const manifestPath = path.join(root, 'manifest.json');
		if (!lstatSync(manifestPath).isFile() || realpathSync(manifestPath) !== manifestPath)
			return false;
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
		if (
			manifest.version !== 1 ||
			manifest.key !== key ||
			manifest.edition !== edition ||
			!Array.isArray(manifest.files) ||
			manifest.filesSha256 !== digest(JSON.stringify(manifest.files)) ||
			!manifest.files.length ||
			manifest.files.length > 100000
		)
			return false;
		/** @type {Map<string, Buffer>} */
		const verified = new Map();
		let total = 0;
		for (const file of manifest.files) {
			if (
				typeof file.path !== 'string' ||
				!safePath(file.path) ||
				verified.has(file.path) ||
				!Number.isSafeInteger(file.bytes) ||
				file.bytes < 0 ||
				!/^[a-f0-9]{64}$/.test(file.sha256)
			)
				return false;
			total += file.bytes;
			if (total > 512 * 1024 * 1024) return false;
			const source = path.join(root, 'files', file.path);
			const stat = lstatSync(source);
			if (!stat.isFile() || stat.size !== file.bytes || realpathSync(source) !== source)
				return false;
			const bytes = readFileSync(source);
			if (digest(bytes) !== file.sha256) return false;
			verified.set(file.path, bytes);
		}
		if (!verified.has('pagefind.js') || !verified.has('pagefind-entry.json')) return false;
		mkdirSync(path.dirname(output), { recursive: true });
		temporary = mkdtempSync(`${output}.tmp-`);
		for (const [file, bytes] of verified) {
			mkdirSync(path.dirname(path.join(temporary, file)), { recursive: true });
			writeFileSync(path.join(temporary, file), bytes);
		}
		rmSync(output, { recursive: true, force: true });
		renameSync(temporary, output);
		temporary = undefined;
		return true;
	} catch {
		return false;
	} finally {
		if (temporary) rmSync(temporary, { recursive: true, force: true });
	}
}

/** Publish a successful complete index, then its manifest. Returns portable
 * filenames for encrypted cache transport, including the validating manifest.
 * @param {string} cacheRoot @param {string} output @param {string} key @param {string} edition
 */
export function saveSearchCache(cacheRoot, output, key, edition) {
	const relative = `search/${edition}/${key}`;
	const cache = path.join(cacheRoot, relative);
	const files = filesIn(output);
	if (!files.includes('pagefind.js') || !files.includes('pagefind-entry.json'))
		throw new Error('Incomplete Pagefind output');
	mkdirSync(path.dirname(cache), { recursive: true });
	const temporary = mkdtempSync(`${cache}.tmp-`);
	try {
		const manifest = {
			version: 1,
			key,
			edition,
			files: files.map((file) => {
				const bytes = readFileSync(path.join(output, file));
				mkdirSync(path.dirname(path.join(temporary, 'files', file)), { recursive: true });
				writeFileSync(path.join(temporary, 'files', file), bytes);
				return { path: file, bytes: bytes.length, sha256: digest(bytes) };
			})
		};
		writeFileSync(
			path.join(temporary, 'manifest.json'),
			JSON.stringify({ ...manifest, filesSha256: digest(JSON.stringify(manifest.files)) })
		);
		rmSync(cache, { recursive: true, force: true });
		renameSync(temporary, cache);
		return [`${relative}/manifest.json`, ...files.map((file) => `${relative}/files/${file}`)];
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

/** @param {string} cacheRoot @param {string} edition @param {string[]} files */
export function selectSearchCache(cacheRoot, edition, files) {
	mkdirSync(cacheRoot, { recursive: true });
	const target = path.join(cacheRoot, `search-current-${edition}.json`);
	const temporary = `${target}.tmp-${process.pid}`;
	try {
		writeFileSync(temporary, JSON.stringify(files));
		renameSync(temporary, target);
	} finally {
		rmSync(temporary, { force: true });
	}
}
