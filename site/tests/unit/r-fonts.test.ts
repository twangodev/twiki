import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	captureRRenderProfile,
	lockedRRuntime,
	rFontIdentity,
	rRuntimeVersion
} from '../../tooling/lib/r-runtime';

const fixtures: string[] = [];
function fixture() {
	const root = mkdtempSync(path.join(tmpdir(), 'wisconsin-r-fonts-'));
	fixtures.push(root);
	const bin = path.join(root, 'bin');
	const fonts = path.join(root, 'fonts');
	const configuration = path.join(root, 'configuration');
	for (const directory of [bin, fonts, configuration]) mkdirSync(directory);
	writeFileSync(path.join(fonts, 'sans.ttf'), 'identical portable sans font bytes');
	writeFileSync(path.join(fonts, 'serif.ttf'), 'identical portable serif font bytes');
	writeFileSync(path.join(configuration, 'base.conf'), '<fontconfig>base aliases</fontconfig>');
	writeFileSync(
		path.join(configuration, 'override.conf'),
		'<fontconfig>override aliases</fontconfig>'
	);
	const face = (font: string) =>
		[
			path.join(fonts, `${font}.ttf`),
			`Fixture ${font}`,
			'Regular',
			'100',
			'Fixture',
			'0',
			'True',
			'True',
			'1',
			'unknown'
		].join('\t') + '\n';
	writeFileSync(path.join(root, 'inventory'), face('sans') + face('serif'));
	writeFileSync(path.join(root, 'match'), face('sans'));
	writeFileSync(
		path.join(root, 'configurations'),
		['base.conf', 'override.conf']
			.map((file) => `+ ${path.join(configuration, file)}: active configuration`)
			.join('\n') + '\n'
	);
	for (const [command, output] of [
		['fc-list', 'inventory'],
		['fc-match', 'match'],
		['fc-conflist', 'configurations']
	])
		writeFileSync(
			path.join(bin, command),
			`#!/bin/sh\nexec /bin/cat '${path.join(root, output)}'\n`,
			{ mode: 0o755 }
		);
	const executable = path.join(bin, 'Rscript');
	writeFileSync(executable, '#!/bin/sh\necho "R fixture; knitr 1"\n', { mode: 0o755 });
	const environment = {
		...process.env,
		PATH: bin,
		RSCRIPT: executable,
		FONTCONFIG_PATH: configuration,
		FONTCONFIG_FILE: 'base.conf'
	};
	return { root, fonts, configuration, bin, face, environment };
}
afterEach(() => {
	for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('font identity is portable across host directories and does not expose absolute paths', () => {
	const first = fixture();
	const second = fixture();
	const identity = rFontIdentity(first.environment);
	expect(identity).toMatch(/^fontconfig-v1:[a-f0-9]{64}$/);
	expect(identity).toBe(rFontIdentity(second.environment));
	expect(identity).not.toContain(first.root);
	expect(rRuntimeVersion(first.environment)).not.toContain(first.root);
});

test('font bytes and default matching changes invalidate actual preview cache identity', () => {
	const { root, fonts, face, environment } = fixture();
	const first = rRuntimeVersion(environment, true);
	writeFileSync(
		path.join(fonts, 'sans.ttf'),
		'changed bytes with the same font family, style and version'
	);
	const changedBytes = rRuntimeVersion(environment, true);
	expect(changedBytes).not.toBe(first);
	writeFileSync(path.join(root, 'match'), face('serif'));
	expect(rRuntimeVersion(environment, true)).not.toBe(changedBytes);
});

test('configuration contents and active configuration precedence affect the font identity', () => {
	const { root, configuration, environment } = fixture();
	const first = rFontIdentity(environment);
	writeFileSync(
		path.join(configuration, 'override.conf'),
		'<fontconfig>changed custom family alias</fontconfig>'
	);
	const changedConfiguration = rFontIdentity(environment);
	expect(changedConfiguration).not.toBe(first);
	const configurations = readFileSync(path.join(root, 'configurations'), 'utf8')
		.trimEnd()
		.split('\n');
	writeFileSync(path.join(root, 'configurations'), configurations.reverse().join('\n') + '\n');
	expect(rFontIdentity(environment)).not.toBe(changedConfiguration);
});

test.each(['inventory', 'match'])(
	'empty font %s remains unverified and cannot authorize locked preview reuse',
	(emptyInput) => {
		const { root, environment } = fixture();
		const initialEnvironment = { ...environment };
		const first = rRuntimeVersion(environment, true);
		mkdirSync(path.join(root, 'tooling'));
		writeFileSync(
			path.join(root, 'tooling/r-render-profile.json'),
			JSON.stringify(captureRRenderProfile(environment))
		);
		writeFileSync(path.join(root, emptyInput), '');
		const empty = rRuntimeVersion(environment, true);
		expect(empty).not.toBe(first);
		expect(empty).toContain('fontconfig-unverified-v1:');
		expect(() => lockedRRuntime(root, environment)).toThrow('independently verified fonts');
		expect(environment).toEqual(initialEnvironment);
	}
);

test('unavailable font tools keep R rendering available with a stable process identity', () => {
	const { bin, environment } = fixture();
	rmSync(path.join(bin, 'fc-list'));
	const first = rRuntimeVersion(environment, true);
	expect(first).toContain('R fixture; knitr 1');
	expect(first).toContain('fontconfig-unverified-v1:');
	expect(rRuntimeVersion(environment)).toBe(first);
	expect(rRuntimeVersion(environment, true)).toBe(first);
});
