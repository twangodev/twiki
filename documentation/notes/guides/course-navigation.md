---
title: Group courses and sections
---

# Group courses and sections

Course grouping is a navigation setting. It does not rename folders, change note
URLs, move attachments, or grant access to content.

By default, course navigation groups semester-prefixed folders such as
`fa26-cs759` under **Fall 2026**, newest semester first. Unmatched folders appear
under **Other**. This remains the default for existing Wisconsin consumers.

## School years and other custom groups

Configure `site.navigation.grouping` in `twiki.config.json`:

```json
{
  "version": 1,
  "contentDir": "notes",
  "site": {
    "navigation": {
      "grouping": {
        "mode": "patterns",
        "groups": [
          {
            "label": "Senior Year",
            "courses": ["AP-Calculus-BC", "Biology-1"]
          },
          {
            "label": "Junior Year",
            "courses": ["AP-Calculus-AB", "AP-Statistics"]
          },
          {
            "label": "Grade 7",
            "match": "-7$"
          }
        ],
        "fallback": "Unassigned"
      }
    }
  }
}
```

- `courses` matches exact top-level course folder names, including casing.
- `match` is a regular expression tested against the folder name, not the note
  title. Anchor patterns with `^` and `$` when an exact match is intended.
- Either matcher can select a course. Groups are shown in configuration order;
  the first matching group wins, so a course appears once.
- Courses inside a group are sorted naturally by readable title. Empty groups
  are omitted, and unmatched courses appear under `fallback` at the end.
- Searching the course switcher matches group headings as well as course names.
- Explicitly matched courses can contain only an `index.md` overview; they still
  appear in their group and have an Overview link.

Use exact course lists for school years when course names do not encode the year.
No year is inferred from publication dates or course subject.

## A flat list

Set `"grouping": { "mode": "none" }` for a single alphabetical course list
without group headings. Set `mode` back to `semester` to restore semester groups.

Navigation wording and the `courses`/`sections` mode remain configurable through
`site.navigation`; see [[reference/configuration|Configuration reference]].
