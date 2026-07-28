# Changelog

Every released version gets a `## [x.y.z] - YYYY-MM-DD` section here, newest
first. The release workflow pastes that section into the GitHub release notes
verbatim, so write it for someone installing the plugin, not for someone reading
the diff. `npm run check-changelog` fails if the section for `manifest.json`'s
version is missing or empty.

## [1.0.2] - 2026-07-27

### Added

- Open links from note content — a link inside a card resolves the same way it
  does in the note.
- Reorder siblings by dragging a card onto its new place among them.
- Grow the tree straight from a card, with the add button that appears on hover.

### Fixed

- The release tag is now pinned to the manifest version, so a mistyped or
  `v`-prefixed tag fails the build instead of producing a release that Obsidian
  silently refuses to install.

## [1.0.1] - 2026-07-27

### Added

- Expand a content block into a rendered dialog.

## [1.0.0] - 2026-07-27

Initial release.

### Added

- Toggle any note into an editable mind map in the same tab. Every edit writes
  straight back to the original `.md` file — no new files are ever created.
- Note content is drawn as cards alongside the headings it belongs to.
- Maps open folded, and sections holding only note content fold with them.
- LaTeX in node titles renders through MathJax.
- Cards size themselves horizontally to their text, CJK included.

### Fixed

- Fold toggles that did nothing when clicked.
- The map jumping as sections folded and unfolded.
