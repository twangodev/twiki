# Converting binaries

Binaries (PDFs, slides, scans, audio) become markdown, get reviewed, then the
binary is deleted. Two exceptions:

- **Functional binaries** course code uses (jars, datasets, sprites, build
  files) are not content — leave them.
- **Print artifacts**: a PDF that is the printable rendering of a markdown
  note that already exists (exam cheatsheets, reference sheets meant to be
  printed) is kept next to its note and linked from it
  (`Printable version: [[cheatsheet.pdf]]`). The markdown stays the source of
  truth; never delete the PDF, never treat it as unconverted content.

## Routing: pick the right path

- **Text-dense documents** (specs, handouts, exams, textbook chapters):
  mineru → Claude touch-up. Faithful, fast, extracts figures.
- **Slide decks, sparse/visual pages, heavy handwriting**: Claude reads the
  PDF directly (≤20 pages per pass) and writes proper notes. Mineru output on
  slides is fragmented — don't file it as-is.
- **Figures either way:** Claude can't crop images out of a page. When a
  Claude-read document has diagrams worth keeping, also run mineru on it
  purely as a figure extractor and pull the crops from its `images/`.
- **Audio:** `uv run poe transcribe` (or
  [cohere-transcribe-cli](https://github.com/twangodev/cohere-transcribe-cli)).
  Transcripts are raw material, not output — see [[lecture]] for synthesis.
- **Textbooks:** convert, one file per chapter (`textbook/ch-NN.md`). Never
  file a whole book as one note.

## Tools

- `uv run mineru -p <input> -o /tmp/<scratch> -l en`
- Batches: start `uv run mineru-vllm-server` once, add
  `-b hybrid-http-client -u http://127.0.0.1:<port>` to each run. One server
  shared by all agents; kill it when done.
- Same-named inputs (`p01/spec.pdf`, `p02/spec.pdf`) must be staged with
  unique names first.

## From raw output to filed content

Mineru emits `<doc>.md` + hash-named `images/` + debug files (`layout.pdf`,
`origin.pdf`, `*.json`). Keep only the markdown and the figures it references.

1. Place the markdown per the relevant formatting spec. If a note for this
   content already exists (e.g. `![[lecture.pdf]]` embedded in old notes),
   **merge** — the converted content replaces the embed, the rewrite
   supersedes the old note, personal remarks carry over.
2. Move referenced figures to the per-directory `assets/`, renamed
   `<doc>-figNN.<ext>`; rewrite the links. (Renaming any file means rewriting
   every reference in the same commit — and wikilinks may contain spaces, so
   search thoroughly, don't trust one grep pattern.)
3. Fix OCR artifacts: tag untagged ` ```txt ` fences with the real language,
   rejoin split ligatures ("fi ve"), convert `●`/`○` glyphs to `-` lists,
   repair flat heading hierarchy.
4. Wire it into the graph: link from the course README and related notes.
5. Review against the original, then delete the binary.
