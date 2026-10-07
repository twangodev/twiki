import { existsSync, type FSWatcher } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { prepareContent } from './pipeline';
import { contentRepositories, watchContentGitDirectory } from './lib/dev-git-state';
import { rebuildQueue } from './lib/rebuild-queue';
import { resolveRuntimeDataImport } from './lib/runtime-data-modules';

export function content(): Plugin {
	return {
		name: 'wisconsin-content',
		enforce: 'pre',
		resolveId(source) {
			return resolveRuntimeDataImport(source, this.environment.config);
		},
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
			let forceRebuild = false;
			let gitTopologyChanged = true;
			const gitWatchers = new Map<
				string,
				{ watcher: FSWatcher; recursive: boolean; files: Set<string>; repositories: Set<string> }
			>();
			const queue = rebuildQueue(async () => {
				if (closed) return;
				try {
					const inputs = changedInputs;
					changedInputs = new Set();
					const reuse = !forceRebuild && !failure;
					forceRebuild = false;
					if (gitTopologyChanged) {
						refreshGitWatchers();
						gitTopologyChanged = false;
					}
					// Git can refresh an index or another worktree's ref without changing
					// our inputs. Validate its snapshot; content events and failure
					// recovery still force reconciliation.
					const changed = await prepareContent(reuse, inputs, true);
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
					forceRebuild = true;
					gitTopologyChanged = true;
					server.config.logger.error(failure.message);
					server.ws.send({
						type: 'error',
						err: { message: failure.message, stack: failure.stack ?? '' }
					});
				}
			});
			const rebuild = (file: string) => {
				forceRebuild = true;
				changedInputs.add(file);
				queue.schedule();
			};
			const rebuildGit = (repository: string) => {
				changedInputs.add(repository);
				queue.schedule();
			};
			const changed = (event: string, file: string) => {
				if (!['add', 'change', 'unlink'].includes(event)) return;
				if (
					file === path.join(repo, '.gitmodules') ||
					(file.startsWith(directory + path.sep) &&
						['.gitmodules', '.git'].includes(path.basename(file)))
				) {
					gitTopologyChanged = true;
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
			function refreshGitWatchers() {
				const wanted = new Map<
					string,
					{ recursive: boolean; files: Set<string>; repositories: Set<string> }
				>();
				const add = (directory: string, file: string, repository: string, recursive = false) => {
					const entry = wanted.get(directory) ?? {
						recursive,
						files: new Set<string>(),
						repositories: new Set<string>()
					};
					entry.recursive ||= recursive;
					entry.files.add(file);
					entry.repositories.add(repository);
					wanted.set(directory, entry);
				};
				for (const repository of contentRepositories(repo)) {
					for (const file of [
						repository.index,
						repository.config,
						repository.worktreeConfig,
						path.join(repository.gitDirectory, 'HEAD'),
						path.join(repository.commonDirectory, 'packed-refs'),
						path.join(repository.commonDirectory, 'refs')
					])
						add(path.dirname(file), path.basename(file), repository.directory);
					const refs = path.join(repository.commonDirectory, 'refs');
					if (existsSync(refs)) add(refs, '', repository.directory, true);
				}
				for (const [directory, entry] of gitWatchers) {
					if (!wanted.has(directory) || wanted.get(directory)!.recursive !== entry.recursive) {
						entry.watcher.close();
						gitWatchers.delete(directory);
					}
				}
				for (const [directory, entry] of wanted) {
					const previous = gitWatchers.get(directory);
					if (previous) {
						previous.files = entry.files;
						previous.repositories = entry.repositories;
						continue;
					}
					// Watch metadata directories shallowly; recurse only through refs,
					// never through the shared object store.
					const watcher = watchContentGitDirectory(
						directory,
						entry.recursive,
						() => gitWatchers.get(directory)?.files ?? new Set(),
						() => {
							const current = gitWatchers.get(directory);
							if (closed || !current) return;
							gitTopologyChanged = true;
							for (const repository of current.repositories) rebuildGit(repository);
						}
					);
					if (!watcher) continue;
					watcher.on('error', () => {
						const current = gitWatchers.get(directory);
						watcher.close();
						gitWatchers.delete(directory);
						if (closed) return;
						gitTopologyChanged = true;
						for (const repository of current?.repositories ?? []) rebuildGit(repository);
					});
					gitWatchers.set(directory, { ...entry, watcher });
				}
			}
			refreshGitWatchers();
			gitTopologyChanged = false;
			server.middlewares.use((request, response, next) => {
				void queue
					.wait()
					.then(async () => {
						if (failure) return next(failure);
						// Keep optional renderers and history builders off the startup path.
						const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
						if (pathname.startsWith('/__content/history')) {
							const { serveDevHistory } = await import('./lib/dev-history');
							if (serveDevHistory(request, response, server.config.root, repo)) return;
						}
						if (pathname.startsWith('/_og/')) {
							const { serveDevSocialImage } = await import('./lib/dev-social-images');
							if (await serveDevSocialImage(request, response, server.config.root)) return;
						}
						next();
					})
					.catch(next);
			});
			server.httpServer?.once('close', () => {
				closed = true;

				server.watcher.off('all', changed);
				for (const { watcher } of gitWatchers.values()) watcher.close();
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
