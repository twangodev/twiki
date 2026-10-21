import { readDevRmdRequest } from './lib/dev-rmd';
import { buildRmdPreviews } from './lib/rmd-previews';

const abort = new AbortController();
process.once('disconnect', () => abort.abort());
process.once('SIGTERM', () => abort.abort());
function reply(message: { key?: string; error?: string }) {
	if (process.connected) process.send?.(message, () => process.disconnect?.());
}

try {
	const site = process.cwd();
	const selection = readDevRmdRequest(site, new URL(process.argv[2], 'http://localhost'));
	const results = await buildRmdPreviews(
		site,
		selection.course,
		selection.files,
		selection.output,
		() => {},
		{
			worksheet: selection.file,
			publish: false,
			refreshRuntime: true,
			signal: abort.signal
		}
	);
	reply({ key: results.get(selection.file)?.key });
} catch (error) {
	reply({ error: String(error) });
}
