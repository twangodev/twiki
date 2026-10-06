import { expect, test } from 'bun:test';
import type { FSWatcher } from 'node:fs';
import { watchContentGitDirectory } from '../../tooling/lib/dev-git-state';

test('Git watchers reconcile unknown events and filter unrelated shallow metadata events', () => {
	let event!: (event: string, file: string | Buffer | null) => void;
	let rebuilds = 0;
	const files = new Set(['index']);
	watchContentGitDirectory(
		'/fixture/.git',
		false,
		() => files,
		() => rebuilds++,
		(_directory, _options, listener) => {
			event = listener;
			return {} as FSWatcher;
		}
	);
	event('change', 'objects');
	expect(rebuilds).toBe(0);
	event('change', null);
	expect(rebuilds).toBe(1);
	event('rename', Buffer.from('index'));
	expect(rebuilds).toBe(2);
	files.add('config');
	event('change', 'config');
	expect(rebuilds).toBe(3);
});

test('Git watcher creation tolerates disappeared paths and exposes resource and permission errors', () => {
	for (const code of [
		'ENOENT',
		'ENOTDIR',
		'ENOSPC',
		'EACCES',
		'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM'
	]) {
		const error = Object.assign(new Error(code), { code });
		const create = () =>
			watchContentGitDirectory(
				'/fixture/.git',
				true,
				() => new Set(),
				() => {},
				() => {
					throw error;
				}
			);
		if (['ENOENT', 'ENOTDIR'].includes(code)) expect(create()).toBeUndefined();
		else expect(create).toThrow(error);
	}
});
