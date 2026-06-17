---
name: addtag
description: 'Detect the current repository''s version, then create a matching local git tag. If a tag for that version already exists, ask the user how to proceed.'
button:
  label: Add Tag
  icon: tag
  order: 4
  submit: send
---

# Add Tag: Create a Local Git Tag for the Current Version

Create a **local** git tag matching the current version of **the repository
open in this workspace**. Do not assume any particular language, file, or
scheme — discover how *this* repo tracks its version, then tag it locally.

## Phase 1: Discover the Current Version

Inspect the repository to find where and how the version is defined. Check the
common sources (use whichever actually exist here — there may be more than one):

- `package.json` (`version`), `Cargo.toml`, `pyproject.toml` / `setup.py` /
  `setup.cfg` / `__version__`, `*.csproj` / `AssemblyInfo`, `pubspec.yaml`,
  `build.gradle` / `gradle.properties`, `composer.json`, etc.
- Plain `VERSION` / `version.txt` files.
- A changelog (`CHANGELOG.md`) that records the latest released version.

Determine the **current version string**. If no version system can be found,
stop and ask the user where the version lives — do not invent one.

## Phase 2: Determine the Tag Name and Check for an Existing Tag

Derive the tag name from the version using the repo's existing convention.
Inspect existing tags with `git tag --list` to learn the convention (e.g.
`v1.2.3` vs `1.2.3` vs `release-1.2.3`); if there are no tags yet, default to
the `v`-prefixed form (`v<version>`).

Check whether a tag for this exact version already exists
(`git tag --list "<tag>"`).

- **If the tag already exists**: use #tool:vscode/askQuestions to tell the user
  that a tag for this version already exists, and ask how to proceed. Offer
  choices such as: keep the existing tag (do nothing / abort), move the tag to
  the current commit (`git tag -f`), or delete and recreate it. Do not modify
  or delete any tag without the user's explicit choice.
- **If the tag does not exist**: proceed to Phase 3.

## Phase 3: Create the Local Tag

Create the tag **locally only** on the current commit (HEAD). Use an annotated
tag (`git tag -a "<tag>" -m "<message>"`) with a concise message referencing the
version. **Do not push the tag** to any remote and do not create or move tags on
a remote — this is a local-only operation.

## Phase 4: Confirm

Report the tag that was created (or the action taken on an existing tag) and the
commit it points to back to the user. Remind them that the tag is local and not
yet pushed.
