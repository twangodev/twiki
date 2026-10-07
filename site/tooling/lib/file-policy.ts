import { createHash } from 'node:crypto';

const excludedDirectories = new Set([
	'node_modules',
	'vendor',
	'build',
	'dist',
	'target',
	'__pycache__'
]);
const excludedNames =
	/^(?:credentials?|secrets?|id_rsa|id_ed25519)(?:[._-]|$)|\.(?:pem|key|p12|pfx|keystore)$/i;

/** Shared path policy without loading course history or R preview rendering. */
export function browsablePath(file: string) {
	return (
		!file.includes('\\') &&
		!file.split('/').includes('publish.yaml') &&
		!/[\x00-\x1f\x7f]/.test(file) &&
		file
			.split('/')
			.every(
				(segment) =>
					segment.length > 0 &&
					!segment.startsWith('.') &&
					!excludedDirectories.has(segment.toLowerCase()) &&
					!excludedNames.test(segment)
			)
	);
}

export function fileHistoryPolicyKey() {
	return createHash('sha256')
		.update(browsablePath.toString())
		.update(JSON.stringify([...excludedDirectories].sort()))
		.update(excludedNames.source)
		.digest('hex');
}
