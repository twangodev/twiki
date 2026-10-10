---
title: Git and submodules
---

# Git and submodules

Plain Obsidian vaults can use filesystem discovery without Git. To publish tracked files and nested course repositories, use:

```json
{"version":1,"contentDir":"content","discovery":"git","publication":"policies"}
```

Git discovery reads recursive tracked files and explicitly declared submodules. Initialize those submodules before building. Untracked notes are excluded in Git mode; filesystem discovery reads visible ordinary files instead.

Twiki does not edit notes, commit submodules or update Git pointers. Hidden directories such as `.obsidian` and `.twiki`, dependency directories, credentials and unsafe symlink paths are excluded from discovery.

For general documentation, set `site.navigation.mode` to `sections`. Course navigation remains the default for compatibility. See [[reference/configuration|Configuration reference]].
