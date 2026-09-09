import { watch } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { Plugin } from 'vite';
import { prepareContent } from './pipeline';
import { parseGitmodules } from './lib/lastmod';

export function content(): Plugin {
	return {
		name: 'wisconsin-content',
		enforce: 'pre',
		config: {
			order: 'pre',
			async handler(_config, environment) {
				if (environment.command === 'build' && process.env.npm_lifecycle_event !== 'prepare')
					await prepareContent(true);
			}
		},
		async configureServer(server) {
			await prepareContent(true);
			const repo = process.env.WISCONSIN_CONTENT_REPO ?? path.resolve(server.config.root, '..');
			const directory = path.join(repo, 'content');
			let pending = Promise.resolve();
			let timer: ReturnType<typeof setTimeout>;
			let closed = false;
			let failure: Error | undefined;
			const rebuild = () => {
				clearTimeout(timer);
				timer = setTimeout(() => {
					pending = pending.then(async () => {
						if (closed) return;
						try {
							await prepareContent();
							failure = undefined;
							for (const environment of Object.values(server.environments))
								environment.moduleGraph.invalidateAll();
							server.ws.send({ type: 'full-reload' });
						} catch (error) {
							failure = error instanceof Error ? error : new Error(String(error));
							server.config.logger.error(failure.message);
							server.ws.send({
								type: 'error',
								err: { message: failure.message, stack: failure.stack ?? '' }
							});
						}
					});
				}, 100);
			};
			const changed = (_event: string, file: string) => {
				if (file.startsWith(directory + path.sep) || file === path.join(repo, '.gitmodules'))
					rebuild();
			};
			server.watcher.add([directory, path.join(repo, '.gitmodules')]);
			server.watcher.on('all', changed);
			const repositories = [
				repo,
				...parseGitmodules(path.join(repo, '.gitmodules')).map((course) => course.fullPath)
			];
			const gitWatchers = repositories.flatMap((repository) => {
				try {
					const index = execFileSync(
						'git',
						['-C', repository, 'rev-parse', '--path-format=absolute', '--git-path', 'index'],
						{ encoding: 'utf8' }
					).trim();
					return [
						watch(path.dirname(index), (_event, file) => {
							if (file && ['index', 'HEAD', 'packed-refs'].includes(String(file))) rebuild();
						})
					];
				} catch {
					return [];
				}
			});
			server.middlewares.use((_request, _response, next) => {
				void pending.then(() => next(failure), next);
			});
			server.httpServer?.once('close', () => {
				closed = true;
				clearTimeout(timer);
				server.watcher.off('all', changed);
				for (const watcher of gitWatchers) watcher.close();
			});
		},
		handleHotUpdate({ file }) {
			if (file.includes('/src/lib/generated/') || file.includes('/build/generated/')) return [];
		}
	};
}
