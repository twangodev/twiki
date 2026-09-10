import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRevisionLookup } from '../../tooling/lib/git-revisions';

test('revision cache survives reloads, isolates HEADs, and recovers from truncation', () => {
	const cache = mkdtempSync(path.join(tmpdir(), 'wisconsin-revisions-'));
	const head = 'a'.repeat(40);
	const revision = 'b'.repeat(40);
	let calls = 0;
	const lookup = (_file: string) => {
		calls++;
		return revision;
	};
	try {
		const first = createRevisionLookup(head, cache, lookup);
		expect(first('notes.md')).toBe(revision);
		expect(first('notes.md')).toBe(revision);
		expect(first('__proto__')).toBe(revision);
		expect(calls).toBe(2);
		const restored = createRevisionLookup(head, cache, lookup);
		expect(restored('notes.md')).toBe(revision);
		expect(restored('__proto__')).toBe(revision);
		expect(calls).toBe(2);
		createRevisionLookup('c'.repeat(40), cache, lookup)('notes.md');
		expect(calls).toBe(3);
		writeFileSync(path.join(cache, `revisions-v1-${head}.jsonl`), '["notes.md",');
		expect(createRevisionLookup(head, cache, lookup)('notes.md')).toBe(revision);
		expect(calls).toBe(4);
		expect(createRevisionLookup(head, cache, lookup)('notes.md')).toBe(revision);
		expect(calls).toBe(4);
	} finally {
		rmSync(cache, { recursive: true, force: true });
	}
});
