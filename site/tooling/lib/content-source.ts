import { createHash } from 'node:crypto';
import fs, { type BigIntStats } from 'node:fs';

interface ContentSource {
	readonly abs: string;
	readonly rel: string;
	readonly stat: Readonly<BigIntStats>;
}

// Retain only identities and derived keys for the current source selection, never Markdown.
const validatedSources = new Map<string, { identity: string; parseKey: string }>();

/** Identity-based dev builds supply contained source observations and validate the pass afterward. */
export function contentSourceReader(
	sources: readonly ContentSource[],
	renderer: string,
	reuse = false,
	changedInputs?: ReadonlySet<string>
) {
	if (reuse) {
		const selected = new Set(sources.map((source) => source.abs));
		for (const file of validatedSources.keys())
			if (!selected.has(file)) validatedSources.delete(file);
	}
	return (source: ContentSource) => {
		const info = source.stat;
		const identity =
			reuse && info.isFile()
				? JSON.stringify([
						renderer,
						source.rel,
						...[info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs].map(String)
					])
				: undefined;
		const previous = validatedSources.get(source.abs);
		if (identity && previous?.identity === identity && !changedInputs?.has(source.abs))
			return { parseKey: previous.parseKey, raw: undefined };
		const raw = fs.readFileSync(source.abs, 'utf8');
		const parseKey = createHash('sha256').update(`${renderer}|${source.rel}|${raw}`).digest('hex');
		if (identity) validatedSources.set(source.abs, { identity, parseKey });
		return { parseKey, raw };
	};
}
