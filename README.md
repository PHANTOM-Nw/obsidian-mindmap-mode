# Mindmap Mode

*[中文说明](README.zh.md)*

Turn any Obsidian note into an editable, radial mind map — the same way you
switch to reading mode. Same tab, same file, **no new files ever created**.

Every edit you make on the map is written straight back into the original
`.md` note as a minimal line edit. Toggle back and your note is still your note.

The canvas handles much like a desktop mind-mapping tool such as XMind or
MindNode, except the data never stops being your markdown note.

## What it does

- **A view mode, not an export.** Toggling swaps the view type on the leaf you
  are already in, so the same `TFile` stays open in the same tab. Nothing is
  generated, copied, or written to a sidecar file.
- **Your outline is the map.** Headings nest by level; nested bullets hang under
  the heading they belong to. What you already wrote is the structure.
- **Opens folded.** A map starts at the root plus its top-level branches, each
  toggle showing how many nodes are hiding behind it. Open one branch and you get
  one more level, not the whole subtree.
- **Reopens where you left it.** Come back to a note and it is folded the way you
  had it, framed on the card you were working on. That state lives in the
  plugin's own data, never in the note — nothing to diff, nothing to merge.
- **Formulas render.** `$\lambda$` and `$$\sum_{i=1}^{n} x_i$$` are typeset with
  Obsidian's own MathJax. Prices like `$5 and $10` are left as prices.
- **Edit on the canvas.** Rename, add, delete, indent, drag to reparent, drag to
  reorder, fold, tick checkboxes — all of it rewrites the note in place.
- **Nothing else is touched.** Frontmatter, fenced code, tables, HTML and links
  are never reformatted. Lines you did not edit come back byte-for-byte
  identical, including CRLF endings.

## Switching to the map

Any of these work, on the note you already have open:

| Where | How |
| --- | --- |
| Command palette | **Toggle mind map view** (assign a hotkey to make it feel native) |
| Note header | The branch icon beside the other view actions |
| Ribbon | The branch icon in the left sidebar |
| Context menu | Right-click the note → **Open as mind map** |

Toggling back returns you to whichever markdown mode you came from — source or
reading.

## Editing on the map

| Input | Action |
| --- | --- |
| Double-click / `F2` | Edit the node text inline |
| **⤢** on a content card | Show the whole block, rendered |
| Click a link in a content card | Open it — note, heading, PDF, attachment or web address |
| **+** beside a card | New child |
| Right-click a card | The node's menu: add a child, add a sibling above or below, fold, rename, delete |
| `Enter` | New sibling |
| `Tab` | New child |
| `Shift`+`Tab` | Outdent |
| `]` | Indent under the previous sibling |
| `Delete` | Delete the node and its children |
| `Space` | Fold / unfold |
| Arrow keys | Move the selection |
| Drag a card onto another | Reparent it |
| Drag onto a card's top / bottom edge | Drop it in beside that card, above or below |
| `Ctrl`/`Cmd`+`Enter` | Cycle the checkbox: none → `[ ]` → `[x]` → none |
| `Ctrl`/`Cmd`+`Z` | Undo (`Shift` to redo) |
| `Ctrl`/`Cmd`+`0` | Fit the map to the window |
| `Ctrl`/`Cmd`+`F` | Find in the map: `Enter` / `Shift`+`Enter` steps, `Esc` closes |
| Wheel / pinch | Zoom; drag blank space to pan |
| Toolbar | Zoom, fit, centre, **expand all**, **collapse all**, **find**, shortcut help |

**Collapse all** returns the map to the view it opened with, rather than hiding
everything behind the root.

### Finding a node

`Ctrl`/`Cmd`+`F` opens a find bar over the canvas — Obsidian's own editor search
cannot reach a map, so the map brings its own. Matching is case-insensitive
substring by default, with a `.*` toggle for a regular expression; a pattern that
does not compile just marks the box red rather than throwing. There is also a
**Find in the mind map** command if you would rather bind your own hotkey.

Nodes are matched on the text you can see: `**bold** text` is found by "bold
text", and `[[note|Label]]` by "Label" but never by "note". A formula is matched
as its TeX source. Stepping to a match inside a folded branch opens it, and
closing the bar folds it back — branches you opened yourself while searching stay
open. In this version whole matched cards are ringed rather than the matched
substring, and note-content cards (paragraphs, code blocks, tables) are not
searched.

Dragging across the heading/list boundary converts the moved block for you. Drop
a heading onto a bullet and the whole subtree becomes nested bullets; drop a
bullet onto a heading and it becomes a top-level list. Checkbox state survives
the round trip. Dropping *beside* a node works the same way: the block is
written the way that node is written, because a bullet placed after a heading is
that heading's content rather than its sibling.

Top-level branches are not reordered by dragging. The layout splits them between
the two sides of the root by weight, so their order is its to decide — a drop
anywhere on a top-level card reparents, as it always has. From the second level
down, siblings run top to bottom in file order, and the edge of a card is where
you change it.

### Paragraphs, code blocks and tables

Content that is not a heading or a list item stays exactly where it is in the
note — and gets its own card on the map, folding and unfolding with the branch
it belongs to, interleaved with its siblings in file order. Code blocks and
tables keep a monospace face and their own line breaks; prose is set in the
reading face, formulas included.

A card is only a preview: long blocks are clipped on the map, and the map's own
renderer is a small inline one. The **⤢** button in a content card's corner opens
the block whole, rendered by Obsidian itself — display formulas, tables, code
highlighting and callouts all look the way they do in reading view. Switch that
dialog to **Source** (or double-click the card) to edit the block; saving
rewrites only those lines.

Content cards cannot be renamed, dragged or deleted — those lines belong to the
note, and the map is only showing them.

Turn **Show note content** off in the settings to keep them off the map.

## Install

Not in the community plugin browser yet, so install manually:

```bash
npm install
npm run build
```

Then copy `main.js`, `manifest.json` and `styles.css` into your vault:

```bash
mkdir -p /path/to/vault/.obsidian/plugins/mindmap-mode
cp main.js manifest.json styles.css /path/to/vault/.obsidian/plugins/mindmap-mode/
```

Enable **Mindmap Mode** in *Settings → Community plugins*.

For development, symlink the repo instead so `npm run dev` rebuilds in place,
then use *Reload app without saving* (or the Hot-Reload plugin) to pick up changes:

```bash
ln -s "$PWD" /path/to/vault/.obsidian/plugins/mindmap-mode
npm run dev
```

A sample vault lives in `test-vault/` — open that folder as a vault and symlink
the plugin into `test-vault/.obsidian/plugins/` to try it without touching your
real notes.

## Settings

Node source (headings and lists / headings only / lists only), deepest heading
level, root node policy, indent unit for new list items, layout (balanced or
single-sided), branch colours, whether note content appears as cards, card
width, spacing, wheel behaviour, whether to remember fold state, and whether to
add the header button.

Turning **Remember fold state** off makes every map open at the root plus its
top-level branches, as it did before. There is also a command, *Forget the saved
fold state for this note*, for dropping one note's state without touching the
setting.

## How the round trip is kept safe

Every operation is a **line-range splice** on the original text. The map is a
projection: each node remembers the exact line it came from and the exact pieces
of that line (indent, marker, spacing, checkbox, text, trailing suffix), so it
can rebuild itself character-for-character. The file is never regenerated from
the tree.

That invariant is enforced by the test suite rather than assumed:

```bash
npm test
```

It checks, among other things, that a parse/serialize round trip is
byte-identical across frontmatter, CRLF, tilde and nested fences, ordered lists,
empty list items and closing-hash headings; that fenced code never produces
nodes; that **no operation ever touches frontmatter**; and that every legal
reparent across a rich fixture still round-trips with code content intact.

Layout is covered too — cards are asserted never to overlap in deep, uneven
trees, in both balanced and single-sided modes, and laying out the same tree
twice is asserted to land in exactly the same place (the map re-measures without
rebuilding once MathJax has flushed its stylesheet). The `$…$` delimiter rules
live in their own dependency-free module so they can be tested the same way.

## Known limits

- **Setext headings** (`Title` underlined with `===` or `---`) are treated as
  body content, not nodes. They are preserved untouched; ATX (`#`) headings are
  what the map reads.
- The root node is the note's single top-level heading when it has one, and
  otherwise the file name. A file-name root cannot be renamed from the map,
  since that would mean renaming the file.
- Fold state is remembered per note in the plugin's own `data.json`, never in the
  note itself. A node is found again by its heading path, so renaming one forgets
  where it was folded; the branches around it are unaffected. The last 200 notes
  are kept, and a note left at the default fold stores nothing at all.
- Inline math uses a stricter `$…$` rule than Obsidian's reader — the body may
  not begin or end on whitespace, and a closing `$` may not be followed by a
  digit. That is what keeps `$5-$10` a price, at the cost of `$x$2` staying
  literal.
- Moving a checkbox item into heading position keeps `[x]` as literal text
  (headings cannot hold checkboxes). Moving it back restores a real checkbox.

## Development

```
src/model/     parser + mutation engine — pure functions, no Obsidian imports
src/layout/    tidy-tree layout
src/view/      canvas, cards, connectors, interactions, math, the TextFileView
src/main.ts    plugin: view registration, the mode toggle, commands
```

`src/model` and `src/layout` have no DOM or Obsidian dependency, which is why
they can be unit-tested directly with `node --test` (Node 22.6+ strips the
TypeScript types natively — no build step, no test framework).

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 PHANTOM-Nw.

No third-party code is bundled: there are no runtime dependencies, formulas are
typeset by Obsidian's own MathJax, and icons come from Obsidian's `setIcon`.
Neither is redistributed with the plugin.

XMind and MindNode are trademarks of their respective owners; this project is
not affiliated with either and mentions them only to describe how the canvas
behaves. Obsidian is a trademark of Dynalist Inc.
