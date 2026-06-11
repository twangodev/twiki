# Exams

`exams/` with one flat subdirectory per exam: `midterm-1/`, `exam-2/`, `final/`.
Courses that archive past semesters' exams prefix instead (`f23-exam1/`,
`s26-exam2/`) — keep that scheme where it exists.

## Exam directory contents

```
exams/midterm-1/
├── index.md            # hub / converted practice questions
├── review.md           # comprehensive review, organized by lecture/topic
├── cheatsheet.md       # condensed reference (the allowed sheet)
├── sample-N/           # converted past/sample exams
│   └── index.md
├── practice-exam-N/    # generated full practice exams
│   └── index.md
└── practice/           # generated practice, split by topic
    └── <topic>.md
```

Not every exam needs every file — but use these names when the content type
matches.

- **`review.md`** — titled `# <Exam> - Comprehensive Review Cheatsheet`.
  Sections map to lectures (`## Part 1: OS Fundamentals (Lecture 1)`), with
  `###` per concept, tables for comparisons, **bolded key terms**, and
  callouts/blockquotes for common traps ("X is **NOT** a benefit...").
- **`cheatsheet.md`** — the dense exam-day sheet.
- **`sample-N/`** — real past exams, converted. Keep the source
  `questions.pdf`/`solutions.pdf` until conversion is reviewed, then delete.
- **`practice-exam-N/`** — study-assistant-generated exams. Header states
  course, time limit, question count. Frontmatter `title:` optional.

## Question format

This is the signature pattern — every question, real or generated:

```markdown
### Question 3 (1 point)

During a system call, the process's registers are saved in the PCB.

- [ ] True
- [ ] False

> [!success]- Answer
> **Correct: False**
>
> They are saved on the kernel stack; the PCB is used on a context switch.

---
```

- Real exams: `### Question N (X points)`. Generated practice:
  `## N. Topic [Tag]` is also used.
- True/False as `- [ ]` checkboxes; multiple choice as `- **(A)** ...` items.
- Answer always in a **collapsed** `> [!success]- Answer` callout — collapsed
  is what makes self-testing work. Bold the correct answer, then explain,
  including why the wrong options are wrong.
- `---` between questions.

## Linking

`review.md` and the exam hub should wikilink the lectures/homework they cover —
exam ↔ lecture edges are the most valuable part of the graph.
