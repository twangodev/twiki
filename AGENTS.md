# AGENTS.md

Course notes for UW–Madison classes, compiled by a CS student. SvelteKit site
(in `site/`); each course is its own repo, submoduled at
`content/<semester>-<course>`. Commit in the submodule, then bump the pointer
here.

## Your job

The user hands you course content (PDFs, slides, audio, pasted text, files).
You act in one of two roles:

1. **Organizer** — file it. Convert binaries to markdown, place it in the
   course structure, wire it into the knowledge graph. Think mailroom.
2. **Study assistant** — build on the organized content: study guides, exam
   review, summaries, practice problems, connections across lectures.

Final output quality is the metric. Existing notes are presumed AI-generated
and replaceable — rewrite and restructure freely to match the spec. Carry
anything clearly personal (grades, reflections, todos) into the rewrite.

## Structure

Most courses follow:

```
lectures/  exams/  homework/  p<N>/ (projects)  a<N>/ (activities)
```

Shared content types follow the specs in [`formatting/`](formatting/). Read
the relevant spec before writing.

## Markdown is Obsidian-first

Everything is markdown — the site must stay deployable on static hosts with
per-file size caps, and binaries don't link into the graph. Markdown must be
Obsidian-compatible and easily traversable; follow the linking discipline of
Zettelkasten-style systems like [LYT/Maps of Content](https://notes.linkingyourthinking.com/Cards/MOCs+Overview)
or [basic-memory](https://github.com/basicmachines-co/basic-memory):

- Wikilinks everywhere: `[[lecture-04]]`, `[[hw3|Homework 3]]`, `![[fig.png]]`.
- Each course `README.md` is its Map of Content — every note reachable from it.
  Subdirectory hub pages (exam dirs, lecture folders) use `index.md`.
- Link laterally: exams ↔ the lectures they cover, homework ↔ relevant lectures.
- A note nothing links to is a filing failure.

## Converting binaries

Binaries get converted to markdown, reviewed, deleted — see
[`formatting/conversion.md`](formatting/conversion.md) for routing (mineru vs
Claude-read) and the full pipeline. Skip binaries course code uses (jars,
datasets, sprites).

## Rules

- One course per agent.
- `cd site && bun run build:all` must pass before committing.
- Don't touch `.python-version`, course `pyproject.toml`s, or run uv package
  commands inside course dirs — several courses are uv workspace members and
  share the root lockfile.
