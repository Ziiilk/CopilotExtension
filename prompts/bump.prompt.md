---
name: bump
description: 'Detect the current repository''s versioning scheme and bump the version, letting you pick which part (major / minor / patch / etc.) via a question.'
button:
  label: Bump Version
  icon: versions
  order: 2
  submit: send
---

# Bump Version: Increment This Repository's Version

Increment the version of **the repository currently open in this workspace**.
Do not assume any particular language, file, or scheme — discover how *this*
repo tracks its version, then bump it.

## Phase 1: Discover the Current Versioning Scheme

Inspect the repository to find where and how the version is defined. Check the
common sources (use whichever actually exist here — there may be more than one,
kept in sync):

- `package.json` (`version`), `Cargo.toml`, `pyproject.toml` / `setup.py` /
  `setup.cfg` / `__version__`, `*.csproj` / `AssemblyInfo`, `pubspec.yaml`,
  `build.gradle` / `gradle.properties`, `composer.json`, etc.
- Plain `VERSION` / `version.txt` files.
- Git tags (`git tag --list`, `git describe --tags`) when the repo is
  tag-versioned with no in-tree version field.
- A changelog (`CHANGELOG.md`) that records the latest released version.

Determine the **current version string** and its format (e.g. semver
`major.minor.patch`, calendar versioning, a bare integer). If multiple files
hold the version, note all of them so they can be updated together. If no
version system can be found, stop and ask the user where the version lives —
do not invent one.

## Phase 2: Ask Which Part to Bump

Use #tool:vscode/askQuestions to ask the user which part to increment. Build the
option list **from the scheme discovered in Phase 1**, and for each option show
the concrete resulting version computed from the current one. For standard
semver, offer:

- **patch** (`X.Y.Z` → `X.Y.(Z+1)`) — backward-compatible fixes.
- **minor** (`X.Y.Z` → `X.(Y+1).0`) — backward-compatible features.
- **major** (`X.Y.Z` → `(X+1).0.0`) — breaking changes.

If the repo uses a different scheme (calver, bare integer, pre-release/build
suffixes, etc.), adapt the choices to match it. Do not proceed until the user
answers.

## Phase 3: Apply the Bump

Write the new version to **every** location identified in Phase 1, keeping them
in sync and preserving each file's existing formatting — change nothing else.
If the repo is tag-versioned, prepare the appropriate tag (but do not push or
create tags without the user's confirmation).

## Phase 4: Confirm

Report the version change (`old → new`) and exactly which files/locations were
updated back to the user.
