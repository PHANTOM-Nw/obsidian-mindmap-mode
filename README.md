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
- **Notes on a node.** A line written as `: text` under a heading or a bullet
  becomes that node's [annotation](#node-annotations) — muted text under its
  card, not a card of its own. Obsidian's editing and reading views show the
  same line as an ordinary paragraph that starts with a colon.
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
| Double-click an annotation | Edit the `: ` lines under that card |
| **⤢** on a content card | Show the whole block, rendered |
| Click a link in a content card | Open it — note, heading, PDF, attachment or web address |
| **+** beside a card | New child |
| Right-click a card | The node's menu: add a child, add a sibling above or below, annotate, fold, rename, delete |
| `Enter` | New sibling |
| `Tab` | New child |
| `Shift`+`Tab` | Outdent |
| `]` | Indent under the previous sibling |
| `Ctrl`/`Cmd`+`↑` / `↓` | Move the node up / down among its siblings |
| `Delete` | Delete the node and its children |
| `Space` | Fold / unfold |
| Arrow keys | Move the selection |
| Drag a card onto another | Reparent it |
| Drag onto a card's top / bottom edge | Drop it in beside that card, above or below |
| `Ctrl`/`Cmd`+`Enter` | Check or uncheck: `[ ]` ⇄ `[x]`, and an item with no checkbox gets one (**Remove checkbox** in the context menu takes it away) |
| `Ctrl`/`Cmd`+`Z` | Undo (`Shift` to redo) |
| `Ctrl`/`Cmd`+`0` | Fit the map to the window |
| `Ctrl`/`Cmd`+`=` / `-` | Zoom in / out |
| `Ctrl`/`Cmd`+`.` | Centre on the selection |
| `Ctrl`/`Cmd`+`F` | Find in the map: `Enter` / `Shift`+`Enter` steps, `Esc` closes |
| Wheel / pinch | Zoom; drag blank space to pan |
| Toolbar | Zoom, fit, centre, **expand all**, **collapse all**, **find**, shortcut help |

Every key in that table is a default. **Settings → Mindmap Mode → Shortcuts**
lists each one with what it does, records a new key for it, clears it, or puts
the default back — and warns when two actions end up on the same key. Open maps
follow a change straight away, and the map's own shortcut help, behind the **?**
in the toolbar, always shows what is bound now.

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
stepping onwards folds that branch back again, so walking a query does not leave
the map spread open behind you. Closing the bar puts back the rest and keeps only
the path to the match you stopped on, still selected and on screen — and branches
you opened yourself while searching stay open throughout. In this version whole
matched cards are ringed rather than the matched substring, and note-content
cards (paragraphs, code blocks, tables) are not searched.

Dragging across the heading/list boundary converts the moved block for you. Drop
a heading onto a bullet and the whole subtree becomes nested bullets; drop a
bullet onto a heading and it becomes a top-level list. Checkbox state survives
the round trip. Dropping *beside* a node works the same way: the block is
written the way that node is written, because a bullet placed after a heading is
that heading's content rather than its sibling.

`Ctrl`/`Cmd`+`↑` and `Ctrl`/`Cmd`+`↓` do the same thing without the pointer:
they swap the selected node — subtree and all — with the sibling above or below
it, and the node stays selected where it lands. At either end of a run nothing
happens and nothing is written. There are **Move the selected node up / down
among its siblings** commands too, unbound, if you would rather use your own
keys.

Top-level branches are not reordered by dragging or by the keyboard. The layout
splits them between the two sides of the root by weight, so their order is its to
decide — a drop anywhere on a top-level card reparents, as it always has. From
the second level down, siblings run top to bottom in file order, and the edge of
a card is where you change it.

### Node annotations

A line that begins with `: ` under a heading or a list item is an annotation:
it hangs under that node's card in muted text behind a vertical rule instead
of becoming a card of its own. Consecutive `: ` lines keep their line breaks,
a lone `:` is a blank line inside the annotation, and a long line wraps at the
width note content gets — **Maximum card width** times 1.6. An annotation may
make its card wider than its title alone would, up to that width, while the
title itself still wraps at **Maximum card width**; a card and the strip under
it are always exactly as wide as each other.

```markdown
### Generalization
: Transfers a skill to an unfamiliar environment.
:
: A second paragraph.

- Adaptation
  : Improves during use.
  : A second line.
```

This is a convention of this plugin, not of Markdown. Obsidian's editing and
reading views show a `: ` line as an ordinary line that happens to start with
a colon, so the note still reads as a note everywhere else — nothing is
rewritten to make the map work, and nothing is added to the file that only the
map understands.

Under a list, indent an annotation to the item's content column, the column
the item's own text starts in. That column also says what the line belongs to:
a `: ` line re-anchors the nesting to the item whose content column it
matches, so list items written after it and indented deeper become that item's
children rather than the previous item's. Four spaces past the content column
is indented code, and fenced code is left alone entirely.

Double-click an annotation, or pick **Add annotation** / **Edit annotation**
from a node's context menu, to open a multiline editor. Enter inserts a line
break, blank lines are kept, and the colon prefixes are written back to the
file for you. `Ctrl`/`Cmd`+`Enter` or **Save** saves; saving an empty box
removes the annotation. The write replaces only the annotation's own lines, so
the rest of the note comes back byte-identical, and an annotation moves with
the node it belongs to. If the annotation changed in the file while the editor
was open, saving is refused and the editor stays open, so the draft is still
there to copy.

An annotation stays visible when its node is folded, and does not depend on
**Show note content**. Turn **Inline annotations** off in Appearance to read
`: ` lines as ordinary body cards again. Find in the mind map matches titles,
not annotations. A node the source or heading-depth settings leave out of the
map keeps its `: ` lines as ordinary body content.

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

## Export

Four commands write the map out as a file of its own — **Export mind map as
Canvas**, **as SVG**, **as PNG** and **as HTML**. They are in the command
palette while a map is the tab in front, and in the tab's *more options* menu.
The same four are also a row of buttons of their own, just above the toolbar in
the map's bottom-right corner.

What you see is what you export. The map is written out with the fold state it
is in, the layout it is in (balanced or one-sided), the branch colours if they
are on, and the colours of the theme you are running — a folded branch is not in
the file, and neither are the selection ring, the find highlights or the hover
buttons.

The file lands beside the note, with the note's name and a new extension. Nothing
is ever overwritten: an export onto a name that is taken becomes `Note 1.svg`,
`Note 2.svg` and so on, the way a duplicate is named anywhere else in Obsidian.

- **Canvas** is the editable one. Every card becomes a text node holding its raw
  markdown, so links, formulas and formatting keep working, and note-content
  cards carry the whole block rather than the preview the map shows. Connectors
  become canvas edges, leaving each card on the side its branch grows from. The
  new `.canvas` opens in a new tab.
- **SVG** is the map as vector art: it scales to any size, and text stays text,
  so it can still be selected and searched. It is not a file to restyle, though
  — every style the map was drawn with is written into it inline, which is what
  lets it stand on its own.
- **PNG** is a bitmap at twice the map's own size, or as close to that as fits
  inside the 16384-pixel limit a canvas has — the notice says so when a map was
  too big for the full scale.
- **HTML** is a single static page, no scripts, that opens in any browser.

The three picture formats carry every style inline, so the file stands on its
own — with one consequence worth knowing: nothing it would have to fetch comes
with it. An image referenced from a note's content is not drawn, and the theme's
web fonts are not embedded, so text falls back to fonts the machine opening the
file already has.

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
single-sided), branch colours, whether note content appears as cards, whether
`: ` lines render as annotations, card width, spacing, wheel behaviour, whether
to remember fold state, and whether to add the header button.

**Inline annotations**, in Appearance, is on: a `: text` line under a heading or
a list item is drawn as that node's [annotation](#node-annotations) rather than
as a body card of its own. Turn it off and every such line is an ordinary
content card again — nothing in the note changes either way.

Turning **Remember fold state** off makes every map open at the root plus its
top-level branches, as it did before. There is also a command, *Forget the saved
fold state for this note*, for dropping one note's state without touching the
setting.

**Shortcuts** is the last group: every key the map answers to, one row each,
with the keys it is on now. **Record** takes the next key you press, whatever it
is — `Esc` abandons the capture instead. The **×** clears the row, leaving the
action on no key at all, and the reset arrow, which appears only on a row you
have changed, puts the default back. Bind two actions to one key and both rows
say so; the one listed higher is the one that answers. **Restore all defaults**
at the foot of the group clears every change at once. Only your changes are
stored, so a default that moves in a later version moves for you too.

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
