---
title: Public vault configuration
---

# Public vault configuration

A public vault with ordinary filesystem discovery:

```json twiki-config
{
  "version": 1,
  "contentDir": "notes",
  "discovery": "filesystem",
  "publication": "public",
  "site": {"name":"My notes","title":"My notes","url":"https://notes.example.com"}
}
```

Create `notes/index.md` as the home note. Run `bunx twiki dev` locally, or follow [[guides/static-hosting|Static hosting]] to export it. Private publication is the initial default from `init`; this example explicitly opts into public access.
