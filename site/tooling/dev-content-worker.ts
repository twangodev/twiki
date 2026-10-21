import { prepareContent } from './pipeline';
import { contentRepositories } from './lib/dev-git-state';
import type { ContentWorkerTask } from './lib/dev-content';

// Vite serializes builds, but also serialize here so overlapping callers cannot
// publish a mixture of two snapshots. Retain compiler caches between requests.
let pending = Promise.resolve();
process.on('message', (message: { id: number } & ContentWorkerTask) => {
	pending = pending.then(async () => {
		try {
			if (message.kind === 'repositories') {
				const repositories = (await contentRepositories(message.repo)).map(
					({ directory, gitDirectory, commonDirectory, index, config, worktreeConfig }) => ({
						directory,
						gitDirectory,
						commonDirectory,
						index,
						config,
						worktreeConfig
					})
				);
				process.send?.({ id: message.id, repositories });
			} else {
				const files = await prepareContent(
					message.reuse,
					message.inputs && new Set(message.inputs),
					true
				);
				process.send?.({ id: message.id, files: [...(files ?? [])] });
			}
		} catch (error) {
			process.send?.({
				id: message.id,
				error: error instanceof Error ? (error.stack ?? error.message) : String(error)
			});
		}
	});
});
process.on('disconnect', () => process.exit(0));
