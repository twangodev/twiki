import { prepareContent } from './pipeline';

// Vite serializes builds, but also serialize here so overlapping callers cannot
// publish a mixture of two snapshots. Retain compiler caches between requests.
let pending = Promise.resolve();
process.on('message', (message: { id: number; reuse: boolean; inputs?: string[] }) => {
	pending = pending.then(async () => {
		try {
			const files = await prepareContent(
				message.reuse,
				message.inputs && new Set(message.inputs),
				true
			);
			process.send?.({ id: message.id, files: [...(files ?? [])] });
		} catch (error) {
			process.send?.({
				id: message.id,
				error: error instanceof Error ? (error.stack ?? error.message) : String(error)
			});
		}
	});
});
process.on('disconnect', () => process.exit(0));
