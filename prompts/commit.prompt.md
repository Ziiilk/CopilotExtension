---
name: commit
description: 'Create a git commit following Conventional Commits, based strictly on the actual local diff rather than conversation context.'
button:
  label: Commit
  icon: git-commit
  order: 3
  submit: send
---

# Commit: Standard Git Commit from Local Changes

Create a git commit whose message is derived **only from the actual local repository changes**, following the Conventional Commits specification.

## Phase 1: Choose Message Language

Use #tool:vscode/askQuestions to ask the user whether the commit message should be written in **中文** or **English**. Do not proceed until the user answers.

## Phase 2: Inspect Actual Changes

Determine the real state of the working tree — **never infer the changes from this conversation's history**:

1. Run `git status` to see staged, unstaged, and untracked files.
2. Run `git diff` (unstaged) and `git diff --staged` (staged) to read the actual content changes.
3. If nothing is staged, stage the relevant changes with `git add` (confirm scope with the user if it is ambiguous which files belong in this commit).

## Phase 3: Compose the Message

Write a Conventional Commits message based solely on the diff from Phase 2, in the language chosen in Phase 1.

Format:

```
<type>(<optional scope>): <subject>

- <change 1>
- <change 2>

<optional footer>
```

Rules:

- **type** must be one of: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **subject**: imperative mood, concise (≤ 50 chars when practical), no trailing period.
- **body** (optional): explain *what* and *why*. When the change spans multiple points, write the body as a **Markdown bullet list** (one `- ` item per logical change) — do **not** cram multiple points into one sentence joined by `；`/`;`. Keep one point per line. Include the body only when the change needs context.
- **footer** (optional): breaking changes (`BREAKING CHANGE:`) or issue references.
- Use a separate `<type>` line per logical change only if truly distinct; otherwise pick the dominant type.
- The message must reflect the real diff — do not invent changes that are not present in the working tree.

## Phase 4: Commit

Run `git commit` with the composed message. Then run `git log -1 --stat` to confirm the commit landed, and report the resulting commit hash and summary back to the user.
