import { existsSync, lstatSync, mkdirSync, readlinkSync, renameSync, symlinkSync } from 'node:fs';
import path from 'node:path';

/** Keep Wrangler's hardcoded temporary paths under the IDE-excluded build directory.
 * @param {string} site
 */
export function prepareWranglerPaths(site) {
	const legacy = path.join(site, '.wrangler');
	const target = path.join(site, 'build/.wrangler');
	mkdirSync(path.dirname(target), { recursive: true });
	const stat = lstatSync(legacy, { throwIfNoEntry: false });
	if (stat?.isSymbolicLink()) {
		if (path.resolve(site, readlinkSync(legacy)) !== target)
			throw new Error('Unexpected .wrangler symlink; refusing to replace local state');
	} else if (stat) {
		if (existsSync(target))
			throw new Error(
				'Both .wrangler and build/.wrangler exist; refusing to overwrite local state'
			);
		renameSync(legacy, target);
	}
	mkdirSync(target, { recursive: true });
	if (!stat?.isSymbolicLink()) symlinkSync('build/.wrangler', legacy, 'dir');
	return target;
}
