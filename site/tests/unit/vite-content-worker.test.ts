import { expect, mock, spyOn, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ContentRepositoryWatch } from '../../tooling/lib/dev-content';
import * as contentWorkers from '../../tooling/lib/dev-content';
import * as gitState from '../../tooling/lib/dev-git-state';
import { content } from '../../tooling/vite-content';

test('Git events arriving during asynchronous discovery trigger another refresh and attach new repository watchers', async () => {
	const root = mkdtempSync(path.join(tmpdir(), 'twiki-git-watcher-race-'));
	const site = path.join(root, 'site');
	mkdirSync(site);
	mkdirSync(path.join(root, 'content'));
	writeFileSync(
		path.join(root, 'twiki.config.json'),
		JSON.stringify({ version: 1, contentDir: 'content', discovery: 'filesystem' })
	);
	const repository = (directory: string): ContentRepositoryWatch => {
		const gitDirectory = path.join(directory, '.git');
		mkdirSync(path.join(gitDirectory, 'refs'), { recursive: true });
		return {
			directory,
			gitDirectory,
			commonDirectory: gitDirectory,
			index: path.join(gitDirectory, 'index'),
			config: path.join(gitDirectory, 'config'),
			worktreeConfig: path.join(gitDirectory, 'config.worktree')
		};
	};
	const original = repository(root),
		added = repository(path.join(root, 'content/late'));
	let release!: () => void, began!: () => void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	const discoveryBegan = new Promise<void>((resolve) => {
		began = resolve;
	});
	let discoveries = 0;
	const worker = {
		prepare: mock(async () => new Set<string>()),
		close: mock(() => {}),
		repositories: mock(async () => {
			discoveries++;
			if (discoveries === 2) {
				began();
				await held;
				return [original];
			}
			return discoveries >= 3 ? [original, added] : [original];
		})
	};
	const workers = spyOn(contentWorkers, 'developmentContent').mockReturnValue(worker);
	const registrations = new Map<string, () => void>();
	const watch = spyOn(gitState, 'watchContentGitDirectory').mockImplementation(
		(directory, _recursive, _files, changed) => {
			registrations.set(directory, changed);
			return Object.assign(new EventEmitter(), {
				close: () => registrations.delete(directory)
			}) as ReturnType<typeof gitState.watchContentGitDirectory>;
		}
	);
	const http = new EventEmitter();
	let middleware!: (request: unknown, response: unknown, next: (error?: unknown) => void) => void;
	const server = {
		config: { root: site, logger: { error: mock(() => {}) } },
		httpServer: http,
		watcher: Object.assign(new EventEmitter(), { add: () => {} }),
		middlewares: {
			use: (handler: typeof middleware) => {
				middleware = handler;
			}
		},
		ws: { send: mock(() => {}) },
		environments: {},
		restart: async () => {}
	};
	const settle = () =>
		new Promise<void>((resolve, reject) =>
			middleware({ url: '/health' }, {}, (error) => (error ? reject(error) : resolve()))
		);
	try {
		await (content().configureServer as (server: unknown) => Promise<unknown>)(server);
		expect(discoveries).toBe(1);
		registrations.get(original.gitDirectory)!();
		await discoveryBegan;
		// A second index/config event arrives after the old topology was read.
		registrations.get(original.gitDirectory)!();
		release();
		await settle();
		expect(discoveries).toBe(3);
		expect(registrations.has(added.gitDirectory)).toBe(true);
		expect(worker.prepare.mock.calls).toHaveLength(3);
		registrations.get(added.gitDirectory)!();
		await settle();
		expect(discoveries).toBe(4);
		expect(worker.prepare.mock.calls).toHaveLength(4);
		expect(server.config.logger.error.mock.calls).toHaveLength(0);
	} finally {
		release();
		http.emit('close');
		workers.mockRestore();
		watch.mockRestore();
		rmSync(root, { recursive: true, force: true });
	}
});
