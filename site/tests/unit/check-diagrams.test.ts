import { stripObsidianComments } from '../../tooling/lib/comments';
import { describe, expect, test } from 'bun:test';
import { expressions, checkMath, markdownFiles } from '../../tooling/check-diagrams';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

describe('Markdown diagram validation', () => {
	test('extracts nested math and Mermaid with source positions, excluding metadata and code', () => {
		const source = [
			'---',
			'title: "$notMath$"',
			'---',
			'',
			'%% $hidden$ %%',
			'`$code$`',
			'```text',
			'$alsoCode$',
			'```',
			'> [!note] Example',
			'> $x^2$',
			'',
			'> ```mermaid',
			'> graph TD',
			'> A --> B',
			'> ```',
			'',
			'$$',
			'\\frac{1}{2}',
			'$$'
		].join('\n');
		expect(expressions(source)).toEqual([
			{ kind: 'math', value: 'x^2', line: 11, column: 3, display: false },
			{ kind: 'mermaid', value: 'graph TD\nA --> B', line: 13, column: 3, display: false },
			{ kind: 'math', value: '\\frac{1}{2}', line: 18, column: 1, display: true }
		]);
	});

	test('accepts valid math and fails on unknown commands and malformed expressions', () => {
		const [good] = expressions('$\\frac{1}{2}$');
		expect(() => checkMath(good)).not.toThrow();
		for (const source of ['$\\notACommand{x}$', '$\\frac{1}{$']) {
			expect(() => checkMath(expressions(source)[0])).toThrow();
		}
	});

	test('includes untracked notes, excludes ignored files, and deduplicates inputs', () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'diagram-discovery-'));
		try {
			execFileSync('git', ['init', '-q', dir]);
			writeFileSync(path.join(dir, '.gitignore'), 'ignored.md\n');
			writeFileSync(path.join(dir, 'ignored.md'), '$bad$');
			mkdirSync(path.join(dir, 'notes'));
			const file = path.join(dir, 'notes', 'new.md');
			writeFileSync(file, '$x$');
			expect(markdownFiles([dir, file])).toEqual([file]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

test('preserves Mermaid comments and directives while removing prose comments', () => {
	const source =
		'%% hidden $bad$ %%\n```mermaid\n%% comment one\ngraph TD\n%% comment two\nA --> B\n```';
	expect(expressions(source)[0].value).toBe('%% comment one\ngraph TD\n%% comment two\nA --> B');
});

test('shared site preprocessing preserves fenced and inline code comments', () => {
	const code = '```mermaid\ngraph TD\n%% first\nA --> B\n%% second\n```';
	expect(stripObsidianComments('%% hidden %%\n' + code)).toBe('\n' + code);
	expect(stripObsidianComments('`%% literal %%` %% hidden %%')).toBe('`%% literal %%` ');
});

test('supports macros shared within a note without leaking between notes', () => {
	const macros = {};
	checkMath(expressions('$\\gdef\\foo{42}$')[0], macros);
	expect(() => checkMath(expressions('$\\foo$')[0], macros)).not.toThrow();
	expect(() => checkMath(expressions('$\\foo$')[0])).toThrow();
});

test('excludes currency pairs from math validation', () => {
	for (const source of [
		'$186 billion for its 1961 comparison, about $1,000 in 2000',
		'$0.08 in 2015, $0.06 in 2018',
		'Costs $5 and $10.',
		'Costs $5–$10.',
		'> Costs $5, $10, and $20.'
	]) {
		expect(expressions(source)).toEqual([]);
	}
});

test('preserves explicit currency, code, and numeric math', () => {
	for (const source of [
		String.raw`Costs \$5 and \$10.`,
		'`$5 and $10`',
		'```sh\necho "$5 and $10"\n```',
		'---\ntitle: "$5 and $10"\n---',
		'%% $5 and $10 %%'
	])
		expect(expressions(source)).toEqual([]);
	for (const source of [
		'$2 + 3$',
		'$2 + 3 $4',
		'$5$',
		'$2x$ and $3y$',
		'$$2 + 3$$',
		String.raw`$2\text{ units}$3`
	]) {
		for (const expression of expressions(source)) expect(() => checkMath(expression)).not.toThrow();
	}
});
