---
title: Write connected notes
---

# Write connected notes

Use ordinary Markdown with Obsidian wikilinks. Give each note a descriptive title in frontmatter or its first heading.

```markdown
---
title: My first note
tags: [example]
---

# My first note

See [[another-note|a related idea]].

![[another-note#A section]]
```

Wikilinks connect notes; aliases change the visible link text. Transclusions embed another note or heading. Attachments can be embedded with `![[image.png]]`. Keep attachment paths inside the vault.

Math uses `$x^2$` inline or double-dollar fences for blocks. Mermaid diagrams use fenced `mermaid` blocks. Try [[examples/connected-notes|Connected notes]] to see these features rendered together.

A home note and folder `index.md` pages make a useful map of content. Add lateral links between related pages so readers can navigate beyond the sidebar. Search and the knowledge graph use these connections.

`bunx twiki check` checks types, links, targets and diagrams. It additionally requires Lychee 0.24.2 and Playwright Chromium; install the browser with `bunx playwright install --with-deps chromium`.
