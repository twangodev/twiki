import { watch } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { Plugin } from 'vite';
import { prepareContent } from './pipeline';
import { parseGitmodules } from './lib/lastmod';
import { serveDevSocialImage } from './lib/dev-social-images';
import { serveDevHistory } from './lib/dev-history';
import { rebuildQueue } from './lib/rebuild-queue';

export function content(): Plugin {
	return {
		name: 'wisconsin-content',
		enforce: 'pre',
		config: {
			order: 'pre',
			async handler(_config, environment) {
				if (
					environment.command === 'build' &&
					process.env.WISCONSIN_SKIP_CONTENT !== '1' &&
					process.env.npm_lifecycle_event !== 'prepare'
				)
					await prepareContent(true);
			}
		},
		async configureServer(server) {
			await prepareContent(true, undefined, true);
			const repo = process.env.WISCONSIN_CONTENT_REPO ?? path.resolve(server.config.root, '..');
			const directory = path.join(repo, 'content');
			let closed = false;
			let failure: Error | undefined;
			let changedInputs = new Set<string>();
			const queue = rebuildQueue(async () => {
				if (closed) return;
				try {
					const inputs = changedInputs;
					changedInputs = new Set();
					const changed = await prepareContent(false, inputs, true);
					const recovered = Boolean(failure);
					failure = undefined;
					if (!changed?.size && !recovered) return;
					const reader = path.resolve(server.config.root, 'src/lib/server/content.ts');
					const generated = path.resolve(server.config.root, 'src/lib/generated') + path.sep;
					for (const environment of Object.values(server.environments)) {
						for (const module of environment.moduleGraph.getModulesByFile(reader) ?? [])
							environment.moduleGraph.invalidateModule(module);
						for (const file of changed ?? []) {
							if (!file.startsWith(generated)) continue;
							for (const module of environment.moduleGraph.getModulesByFile(file) ?? [])
								await environment.reloadModule(module);
						}
					}
					const assetRoot = path.resolve(server.config.root, 'build/generated/assets') + path.sep;
					const changedAsset = [...(changed ?? [])].some(
						(file) =>
							file.startsWith(assetRoot) && !file.startsWith(assetRoot + '_files' + path.sep)
					);
					// Browsers cache image/PDF URLs independently of SvelteKit's page data.
					if (changedAsset) server.ws.send({ type: 'full-reload' });
					else server.ws.send({ type: 'custom', event: 'wisconsin:content', data: { recovered } });
				} catch (error) {
					failure = error instanceof Error ? error : new Error(String(error));
					changedInputs.add(repo); // Recovery must reconcile every course after a partial failure.
					server.config.logger.error(failure.message);
					server.ws.send({
						type: 'error',
						err: { message: failure.message, stack: failure.stack ?? '' }
					});
				}
			});
			const rebuild = (file: string) => {
				changedInputs.add(file);
				queue.schedule();
			};
			const changed = (event: string, file: string) => {
				if (!['add', 'change', 'unlink'].includes(event)) return;
				if (file === path.join(repo, '.gitmodules')) {
					rebuild(file);
					return;
				}
				if (!file.startsWith(directory + path.sep)) return;
				// Hidden paths never enter the content catalog; Git metadata is watched separately.
				if (
					path
						.relative(directory, file)
						.split(path.sep)
						.some((part) => part.startsWith('.'))
				)
					return;
				rebuild(file);
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
							if (file && ['index', 'HEAD', 'packed-refs'].includes(String(file)))
								rebuild(repository);
						})
					];
				} catch {
					return [];
				}
			});
			server.middlewares.use((request, response, next) => {
				void queue
					.wait()
					.then(async () => {
						if (failure) return next(failure);
						if (serveDevHistory(request, response, server.config.root, repo)) return;
						if (!(await serveDevSocialImage(request, response, server.config.root))) next();
					})
					.catch(next);
			});
			server.httpServer?.once('close', () => {
				closed = true;

				server.watcher.off('all', changed);
				for (const watcher of gitWatchers) watcher.close();
			});
		},
		hotUpdate({ file }) {
			if (
				file.includes('/src/lib/generated/') ||
				file.includes('/build/generated/') ||
				file.startsWith(path.resolve('static') + path.sep)
			)
				return [];
		}
	};
}
